import { EmailProvider } from "./types"
import { SmtpProvider } from "./smtpProvider"
import { ResendProvider } from "./resendProvider"

type ProviderType = "smtp" | "resend" | "ses"

function resolveProviderType(brand: any): ProviderType {
  if (!brand) {
    throw new Error(
      "Brand profile missing during provider resolution"
    )
  }

  const provider = brand.provider

  if (!provider) {
    return "smtp"
  }

  if (
    provider !== "smtp" &&
    provider !== "resend" &&
    provider !== "ses"
  ) {
    throw new Error(
      `Invalid provider configured for brand ${brand.id}: ${provider}`
    )
  }

  return provider as ProviderType
}

export async function getProvider(
  brand: any
): Promise<EmailProvider> {
  const providerType = resolveProviderType(brand)

  switch (providerType) {
    case "smtp":
      return new SmtpProvider()

    case "resend":
      return new ResendProvider()

    case "ses":
      throw new Error(
        `SES provider not implemented yet for brand ${brand.id}`
      )

    default:
      throw new Error(
        `Unknown provider type resolved: ${providerType}`
      )
  }
}