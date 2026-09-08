import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildSlackChannelOpenUrl } from "@/lib/slack/channel-name";

type AdminJobSlackPanelProps = {
  slackChannelId: string | null;
  slackEnabled: boolean;
};

export function AdminJobSlackPanel({
  slackChannelId,
  slackEnabled,
}: AdminJobSlackPanelProps) {
  if (!slackEnabled || !slackChannelId) {
    return null;
  }

  const slackUrl = buildSlackChannelOpenUrl(slackChannelId);

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Slack</CardTitle>
        <CardDescription>Dedicated production channel for this job.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <Link
          href={slackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-sm font-medium text-neutral-950 underline-offset-4 hover:underline"
        >
          Open in Slack
        </Link>
      </CardContent>
    </Card>
  );
}
