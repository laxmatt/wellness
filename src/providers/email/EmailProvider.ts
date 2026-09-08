export type MagicLinkEmail = { to: string; url: string; expiresAt: string };

export interface EmailProvider {
  readonly name: string;
  sendMagicLink(msg: MagicLinkEmail): Promise<{ ok: boolean; id?: string }>;
}

export class NoopEmailProvider implements EmailProvider {
  readonly name = "noop";
  async sendMagicLink() {
    return { ok: true, id: "noop" };
  }
}
