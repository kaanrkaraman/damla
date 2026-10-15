export const LANG = browser.i18n.getUILanguage();

export const t = (key: string, ...args: (string | number)[]): string => browser.i18n.getMessage(key, args.map(String)) || key;

export const tn = (key: string, count: number, ...args: (string | number)[]): string =>
  t(`${key}_${new Intl.PluralRules(LANG).select(count)}`, ...args);

export const jobMessage = (message: string | undefined): string =>
  message?.startsWith("@") ? t(`msg_${message.slice(1)}`) : (message ?? "");
