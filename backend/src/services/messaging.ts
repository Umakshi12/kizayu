import nodemailer, { type Transporter } from "nodemailer";
import { APP_NAME, MAIL_FROM, SMTP_URL, TWILIO } from "../config";

export const emailConfigured = () => !!SMTP_URL;
export const smsConfigured = () => !!(TWILIO.sid && TWILIO.token && TWILIO.from);

let transport: Transporter | null = null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!SMTP_URL) { console.log(`[email:dev] to=${to} subject="${subject}"\n${text}`); return; }
  transport ??= nodemailer.createTransport(SMTP_URL);
  await transport.sendMail({ from: MAIL_FROM, to, subject, text });
}

export async function sendSms(to: string, body: string) {
  if (!smsConfigured()) { console.log(`[sms:dev] to=${to}: ${body}`); return; }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${TWILIO.sid}:${TWILIO.token}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO.from!, Body: body }),
  });
  if (!res.ok) throw new Error(`SMS failed (${res.status})`);
}

export const codeText = (code: string, purpose: string) =>
  `Your ${APP_NAME} ${purpose} code is ${code}. It expires in 10 minutes. If you didn't ask for this, ignore this message.`;
