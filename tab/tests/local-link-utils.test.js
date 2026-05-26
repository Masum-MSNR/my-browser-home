const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

const context = {
    console,
    URL,
    JSON,
    String,
    Error,
    Array,
    Object,
    Promise
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('tab/utils.js', 'utf8'), context);

(function run() {
    var remoteInput = { value: '', dataset: {} };
    var localInput = { value: '', dataset: {} };

    context.primeLocalUrlInput(localInput, remoteInput.value, '');
    remoteInput.value = 'h';
    context.syncLocalUrlInputWithRemote(remoteInput, localInput);
    remoteInput.value = 'ht';
    context.syncLocalUrlInputWithRemote(remoteInput, localInput);
    remoteInput.value = 'https://docs.google.com';
    context.syncLocalUrlInputWithRemote(remoteInput, localInput);
    assert('local input mirrors continuous remote typing when not manually edited', localInput.value === 'https://docs.google.com');

    localInput.value = 'http://localhost:3000/sheet';
    context.updateLocalUrlInputManualState(localInput, remoteInput.value);
    remoteInput.value = 'https://docs.google.com/spreadsheets/d/demo/edit';
    context.syncLocalUrlInputWithRemote(remoteInput, localInput);
    assert('manual local override is preserved while remote value changes', localInput.value === 'http://localhost:3000/sheet');

    assert('local override stays device-local when equal to remote is false', context.normalizeLocalOverrideUrl('http://localhost:3000/sheet', remoteInput.value) === 'http://localhost:3000/sheet');
    assert('local override is cleared when same as remote', context.normalizeLocalOverrideUrl(remoteInput.value, remoteInput.value) === '');
    assert('resolved item url prefers local override over synced remote', context.getResolvedItemUrl({ id: 'b1', url: remoteInput.value }, { b1: 'http://localhost:3000/sheet' }) === 'http://localhost:3000/sheet');
    assert('resolved item url falls back to remote when no local override exists', context.getResolvedItemUrl({ id: 'b1', url: remoteInput.value }, {}) === remoteInput.value);
})();