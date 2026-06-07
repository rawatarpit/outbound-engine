import { EmailProvider, SendPayload } from "./types"
import { sendEmail } from "../smtp"

export class SmtpProvider implements EmailProvider {
  async send(payload: SendPayload): Promise<string> {
    const { brandId, brandName, to, subject, body, threadMeta, messageKey } = payload

    const messageId = await sendEmail(
      brandId,
      to,
      subject,
      body,
      messageKey,
      brandName,
      threadMeta
    )

    return messageId
  }
}