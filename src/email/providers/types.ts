export interface SendPayload {
  brandId: string
  brandName?: string
  to: string
  subject: string
  body: string
  threadMeta?: {
    companyId?: string
    leadId?: string
  }
  messageKey?: string
}

export interface EmailProvider {
  send(payload: SendPayload): Promise<string>
}