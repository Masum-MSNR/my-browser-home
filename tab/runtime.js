(function () {
    var DEBUG_STORAGE_KEY = "_appDebugLogs";
    var ISSUE_LIMIT = 50;
    var originalConsole = typeof console !== "undefined" ? {
        log: console.log ? console.log.bind(console) : function () {},
        info: console.info ? console.info.bind(console) : function () {},
        warn: console.warn ? console.warn.bind(console) : function () {},
        error: console.error ? console.error.bind(console) : function () {},
        debug: console.debug ? console.debug.bind(console) : function () {}
    } : null;

    function isDebugEnabled() {
        try {
            return localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
        } catch (e) {
            return false;
        }
    }

    function setDebugEnabled(enabled) {
        try {
            if (enabled) localStorage.setItem(DEBUG_STORAGE_KEY, "1");
            else localStorage.removeItem(DEBUG_STORAGE_KEY);
        } catch (e) {}
    }

    window.__APP_ORIGINAL_CONSOLE__ = originalConsole;
    window.__APP_DEBUG__ = isDebugEnabled();
    window.__APP_ISSUES__ = [];
    window.__reportAppIssue = function (code, message, meta) {
        if (!code) return;
        var key = code + "::" + (message || "");
        var issues = window.__APP_ISSUES__;
        var current = null;
        for (var i = 0; i < issues.length; i++) {
            if (issues[i] && issues[i].key === key) {
                current = issues[i];
                break;
            }
        }
        if (current) {
            current.count += 1;
            current.lastSeenAt = Date.now();
            if (meta) current.meta = meta;
        } else {
            issues.unshift({
                key: key,
                code: code,
                message: message || "",
                meta: meta || null,
                count: 1,
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now()
            });
            if (issues.length > ISSUE_LIMIT) issues.length = ISSUE_LIMIT;
        }
        if (window.__APP_DEBUG__ && originalConsole && typeof originalConsole.warn === "function") {
            originalConsole.warn("[app:" + code + "] " + (message || ""), meta || "");
        }
    };
    window.__getAppIssues = function () { return window.__APP_ISSUES__.slice(); };
    window.__setAppDebug = function (enabled) {
        setDebugEnabled(!!enabled);
        window.location.reload();
    };
    window.__enableAppDebug = function () { window.__setAppDebug(true); };
    window.__disableAppDebug = function () { window.__setAppDebug(false); };

    if (!window.__APP_DEBUG__) {
        window.__APP_DEBUG__ = true;
    }
})();