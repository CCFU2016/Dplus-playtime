// Tiny assertion helper for the wallet tests. Money compares with |Δ| < €0.005 (docs/wallet-brief.md §5).
module.exports = function (name) {
  let fails = 0,
    count = 0;
  const ok = (cond, what) => {
    count++;
    if (!cond) {
      fails++;
      console.log('FAIL [' + name + ']', what);
    }
  };
  return {
    ok,
    money: (got, want, what) =>
      ok(typeof got === 'number' && Math.abs(got - want) < 0.005, what + ': got ' + got + ', want ' + want),
    eq: (got, want, what) =>
      ok(
        JSON.stringify(got) === JSON.stringify(want),
        what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want),
      ),
    throws: (fn, what) => {
      let t = false;
      try {
        fn();
      } catch {
        t = true;
      }
      ok(t, what + ' throws');
    },
    done: () => {
      if (fails) process.exitCode = 1;
      console.log((fails ? 'FAILED ' : 'ok ') + name + ': ' + (count - fails) + '/' + count + ' checks');
    },
  };
};
