const scope = globalThis as { browser?: typeof browser; chrome?: typeof browser };
scope.browser ??= scope.chrome;
