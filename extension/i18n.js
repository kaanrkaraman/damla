globalThis.LANG = browser.i18n.getUILanguage();
globalThis.t = (key, ...args) => browser.i18n.getMessage(key, args.map(String)) || key;
globalThis.tn = (key, n, ...args) => t(`${key}_${new Intl.PluralRules(LANG).select(n)}`, ...args);
