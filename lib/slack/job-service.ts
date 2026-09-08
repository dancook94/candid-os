import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimSlackJobChannelNotification,
  markSlackJobChannelNotificationFailed,
  markSlackJobChannelNotificationSent,
} from "@/lib/slack/delivery";
import { getSlackConfig, isSlackEnabled } from "@/lib/slack/config";
import {
  createJobSlackChannel,
  inviteUsersToSlackChannel,
  postSlackChannelMessage,
} from "@/lib/slack/channels";
import { isSlackError } from "@/lib/slack/errors";
import { loadSlackJobSummaryContext } from "@/lib/slack/job-context-loader";
import { buildJobSummarySlackMessage } from "@/lib/slack/messages/job-summary";
import { resolveJobChannelInviteUserIds } from "@/lib/slack/workspace-members";

export type ProvisionJobSlackChannelResult = {
  ok: boolean;
  skipped?: boolean;
  skippedReason?: string;
  channelId?: string;
  channelName?: string;
  error?: string;
};

type JobSlackRow = {
  id: string;
  job_reference: string;
  project_name: string;
  company_id: string;
  quote_id: string | null;
  slack_channel_id: string | null;
  companies?: { company_name: string | null } | Array<{ company_name: string | null }> | null;
};

function extractCompanyName(
  companies: JobSlackRow["companies"]
): string | null {
  if (!companies) {
    return null;
  }

  const row = Array.isArray(companies) ? companies[0] : companies;
  return row?.company_name?.trim() || null;
}

function isMissingSlackColumnError(error: { code?: string; message?: string }) {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (error.message?.includes("slack_channel_id") ?? false)
  );
}

export async function provisionJobSlackChannel(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    companyId?: string | null;
    quoteId?: string | null;
  }
): Promise<ProvisionJobSlackChannelResult> {
  if (!isSlackEnabled()) {
    return { ok: true, skipped: true, skippedReason: "slack_disabled" };
  }

  const config = getSlackConfig();

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(
      "id, job_reference, project_name, company_id, quote_id, slack_channel_id, companies(company_name)"
    )
    .eq("id", input.jobId)
    .maybeSingle();

  if (jobError) {
    if (isMissingSlackColumnError(jobError)) {
      return { ok: true, skipped: true, skippedReason: "slack_schema_missing" };
    }

    throw jobError;
  }

  if (!job) {
    return { ok: false, error: "Job not found." };
  }

  const typedJob = job as JobSlackRow;

  if (typedJob.slack_channel_id) {
    return {
      ok: true,
      skipped: true,
      skippedReason: "channel_already_linked",
      channelId: typedJob.slack_channel_id,
    };
  }

  const claim = await claimSlackJobChannelNotification(adminClient, {
    jobId: input.jobId,
    companyId: input.companyId ?? typedJob.company_id,
    quoteId: input.quoteId ?? typedJob.quote_id,
  });

  if (!claim.claimed) {
    if (claim.status === "sent" || claim.status === "delivered") {
      const channelId =
        typeof claim.metadata.channelId === "string" ? claim.metadata.channelId : null;

      return {
        ok: true,
        skipped: true,
        skippedReason: "already_provisioned",
        channelId: channelId ?? undefined,
      };
    }

    if (claim.status === "sending") {
      return {
        ok: true,
        skipped: true,
        skippedReason: "provision_in_progress",
      };
    }
  }

  const notificationId =
    claim.claimed && "notificationId" in claim
      ? claim.notificationId
      : !claim.claimed
        ? claim.notificationId
        : null;

  if (!claim.claimed && claim.status === "failed" && notificationId) {
    await adminClient
      .from("notifications")
      .update({
        status: "sending",
        error_message: null,
        failed_at: null,
      })
      .eq("id", notificationId);
  }

  if ("schemaMissing" in claim && claim.schemaMissing) {
    return { ok: true, skipped: true, skippedReason: "notifications_schema_missing" };
  }

  const notificationIdResolved =
    notificationId ??
    (claim.claimed && "notificationId" in claim ? claim.notificationId : null);

  try {
    const companyName =
      extractCompanyName(typedJob.companies) ?? "Unknown company";

    const channel = await createJobSlackChannel({
      jobReference: typedJob.job_reference,
      companyName,
      projectName: typedJob.project_name,
    });

    const { data: updatedJob, error: updateError } = await adminClient
      .from("jobs")
      .update({
        slack_channel_id: channel.channelId,
        slack_channel_created_at: new Date().toISOString(),
      })
      .eq("id", input.jobId)
      .is("slack_channel_id", null)
      .select("slack_channel_id")
      .maybeSingle();

    if (updateError) {
      if (isMissingSlackColumnError(updateError)) {
        return { ok: true, skipped: true, skippedReason: "slack_schema_missing" };
      }

      throw updateError;
    }

    if (!updatedJob?.slack_channel_id) {
      const { data: racedJob } = await adminClient
        .from("jobs")
        .select("slack_channel_id")
        .eq("id", input.jobId)
        .maybeSingle();

      const racedChannelId = (racedJob as { slack_channel_id?: string | null } | null)
        ?.slack_channel_id;

      if (racedChannelId) {
        return {
          ok: true,
          skipped: true,
          skippedReason: "channel_linked_by_parallel_request",
          channelId: racedChannelId,
        };
      }
    }

    let inviteResult = {
      invited: [] as string[],
      failed: [] as Array<{ userId: string; error: string }>,
      discoveryWarning: undefined as string | undefined,
      workspaceMemberCount: 0,
    };

    try {
      const resolvedInvitees = await resolveJobChannelInviteUserIds(config);
      inviteResult.discoveryWarning = resolvedInvitees.discoveryWarning;
      inviteResult.workspaceMemberCount = resolvedInvitees.workspaceMemberCount;

      if (resolvedInvitees.userIds.length > 0) {
        const channelInviteResult = await inviteUsersToSlackChannel(
          channel.channelId,
          resolvedInvitees.userIds
        );

        inviteResult.invited = channelInviteResult.invited;
        inviteResult.failed = channelInviteResult.failed;
      }
    } catch (inviteError) {
      inviteResult.discoveryWarning =
        inviteError instanceof Error
          ? inviteError.message
          : "Slack channel membership invitation failed.";

      if (process.env.NODE_ENV === "development") {
        console.error("[slack] job channel membership invitation failed", {
          jobId: input.jobId,
          channelId: channel.channelId,
          message: inviteResult.discoveryWarning,
        });
      }
    }

    const summaryContext = await loadSlackJobSummaryContext(
      adminClient,
      input.jobId,
      config.appBaseUrl
    );

    let messageTs: string | null = null;

    if (summaryContext) {
      const summary = buildJobSummarySlackMessage(summaryContext);

      const posted = await postSlackChannelMessage({
        channelId: channel.channelId,
        text: summary.text,
        blocks: summary.blocks,
      });

      messageTs = posted.messageTs;
    }

    if (notificationIdResolved) {
      await markSlackJobChannelNotificationSent(adminClient, {
        notificationId: notificationIdResolved,
        channelId: channel.channelId,
        channelName: channel.channelName,
        messageTs,
        inviteFailures: inviteResult.failed,
        inviteDiscoveryWarning: inviteResult.discoveryWarning ?? null,
        invitedMemberCount: inviteResult.invited.length,
        workspaceMemberCount: inviteResult.workspaceMemberCount,
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[slack] provisioned job channel", {
        jobId: input.jobId,
        channelId: channel.channelId,
        channelName: channel.channelName,
        inviteFailures: inviteResult.failed.length,
      });
    }

    return {
      ok: true,
      channelId: channel.channelId,
      channelName: channel.channelName,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Slack job channel provisioning failed.";

    if (notificationIdResolved) {
      try {
        await markSlackJobChannelNotificationFailed(adminClient, {
          notificationId: notificationIdResolved,
          errorMessage,
          metadata: {
            slackError: isSlackError(error)
              ? {
                  code: error.code,
                  slackError: error.slackError ?? null,
                }
              : null,
          },
        });
      } catch (recordError) {
        if (process.env.NODE_ENV === "development") {
          console.error("[slack] failed to record Slack provisioning failure", {
            jobId: input.jobId,
            message:
              recordError instanceof Error ? recordError.message : String(recordError),
          });
        }
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[slack] job channel provisioning failed", {
        jobId: input.jobId,
        message: errorMessage,
      });
    }

    return { ok: false, error: errorMessage };
  }
}

export async function provisionJobSlackChannelSafe(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    companyId?: string | null;
    quoteId?: string | null;
  }
): Promise<ProvisionJobSlackChannelResult> {
  try {
    return await provisionJobSlackChannel(adminClient, input);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Slack job channel provisioning failed.";

    if (process.env.NODE_ENV === "development") {
      console.error("[slack] unexpected provisioning error", {
        jobId: input.jobId,
        message: errorMessage,
      });
    }

    return { ok: false, error: errorMessage };
  }
}
