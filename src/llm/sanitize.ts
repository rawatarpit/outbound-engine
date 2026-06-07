export function sanitizeForPrompt(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  return str
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/```/g, "``\u200b`")
    .replace(/---/g, "-\u200b-")
    .slice(0, 10000);
}

export function buildPrompt(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(
      `\\$\\{\\s*${key}\\s*\\}|\\$\\{${key}\\}`,
      "g",
    );
    const sanitized = sanitizeForPrompt(value);
    result = result.replace(placeholder, sanitized);
  }
  return result;
}
