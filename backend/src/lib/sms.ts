import { logger } from './logger';

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

/** Fournisseur de développement : écrit le SMS dans les logs. */
export class ConsoleSmsProvider implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    logger.info({ to, message }, 'SMS (console)');
  }
}

// En production, implémentez SmsProvider avec votre agrégateur (Orange SMS API, Twilio, Africa's Talking…).
export let sms: SmsProvider = new ConsoleSmsProvider();
export function setSmsProvider(p: SmsProvider) {
  sms = p;
}
