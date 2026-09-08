"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROBLEM_REPORT_ATTACHMENT_ACCEPT } from "@/lib/problem-reports/attachments";
import { validateProblemReportAttachmentFile } from "@/lib/problem-reports/attachments";

type ReportProblemDialogProps = {
  sourcePath?: string;
};

export function ReportProblemDialog({ sourcePath = "/updates" }: ReportProblemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [attemptedAction, setAttemptedAction] = useState("");
  const [priority, setPriority] = useState<"minor" | "blocking">("minor");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetForm() {
    setDescription("");
    setAttemptedAction("");
    setPriority("minor");
    setAttachment(null);
    setError("");
    setSuccess("");
  }

  function handleClose() {
    if (isSubmitting) {
      return;
    }

    setOpen(false);
    resetForm();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!description.trim()) {
      setError("Please describe what went wrong.");
      return;
    }

    if (attachment) {
      const attachmentError = validateProblemReportAttachmentFile(attachment);

      if (attachmentError) {
        setError(attachmentError);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/problem-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description,
          attemptedAction,
          priority,
          sourcePath,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        reportId?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to submit your report.");
        return;
      }

      if (attachment && payload.reportId) {
        const attachmentFormData = new FormData();
        attachmentFormData.append("file", attachment);

        const attachmentResponse = await fetch(
          `/api/problem-reports/${payload.reportId}/attachment`,
          {
            method: "POST",
            body: attachmentFormData,
          }
        );

        if (!attachmentResponse.ok) {
          const attachmentPayload = (await attachmentResponse.json()) as {
            error?: string;
          };

          setSuccess(
            payload.message ??
              "Your report was submitted, but the attachment could not be uploaded."
          );
          setError(
            attachmentPayload.error ??
              "Your report was submitted, but the attachment could not be uploaded."
          );
          router.refresh();
          return;
        }
      }

      setSuccess(payload.message ?? "Thank you. Your problem report has been submitted.");
      router.refresh();

      window.setTimeout(() => {
        handleClose();
      }, 900);
    } catch {
      setError("Unable to submit your report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" size="lg" onClick={() => setOpen(true)}>
        Report a problem
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={handleClose}
          />

          <Card className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border-neutral-200 shadow-lg ring-0">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-lg font-semibold text-neutral-950">
                Report a problem
              </CardTitle>
              <CardDescription>
                Tell us what went wrong and we&apos;ll look into it. Your current page
                and account details are captured automatically.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="problem-description">What went wrong?</Label>
                  <textarea
                    id="problem-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    rows={4}
                    disabled={isSubmitting}
                    placeholder="Describe the issue in plain language..."
                    className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="problem-attempted-action">
                    What were you trying to do?
                  </Label>
                  <textarea
                    id="problem-attempted-action"
                    value={attemptedAction}
                    onChange={(event) => setAttemptedAction(event.target.value)}
                    rows={3}
                    disabled={isSubmitting}
                    placeholder="Optional, but helpful..."
                    className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="problem-priority">Priority</Label>
                  <select
                    id="problem-priority"
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value as "minor" | "blocking")
                    }
                    disabled={isSubmitting}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  >
                    <option value="minor">Minor</option>
                    <option value="blocking">Stopping me working</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="problem-attachment">Screenshot / file (optional)</Label>
                  <Input
                    id="problem-attachment"
                    type="file"
                    accept={PROBLEM_REPORT_ATTACHMENT_ACCEPT}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setAttachment(event.target.files?.[0] ?? null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, JPEG, or PDF up to 10 MB.
                  </p>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                {success ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    {success}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Submitting..." : "Submit report"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
