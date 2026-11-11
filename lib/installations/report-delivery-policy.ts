/**
 * Installation report email preference behaviour:
 *
 * - Contact preference key: `installation_reports` on `contact_notification_preferences`.
 * - Automated delivery (if added later) should resolve the recipient normally and honour
 *   both admin toggles and the contact `installation_reports` preference.
 * - Manager-initiated "Send to customer" always passes `recipientEmailOverride`, which
 *   delivers directly through Resend without reading contact preferences. That keeps an
 *   explicitly authorised manager send from being suppressed by an opt-out.
 */

export const INSTALLATION_REPORT_MANAGER_SEND_BYPASSES_CONTACT_PREFERENCE = true;
