import { useEffect, useState } from 'react';
import { loadOriginalConverter, readOriginalScript, saveOriginalScript } from './original-script';
import type { OriginalConverter } from './original-script';
import type { OriginalScript } from './types';

export function useOriginalScript() {
  const [script, setScript] = useState(readOriginalScript);
  const [converter, setConverter] = useState<OriginalConverter | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (script === 'traditional' || converter) return;
    let cancelled = false;
    setError(false);
    loadOriginalConverter().then(value => {
      if (!cancelled) setConverter(() => value);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [script, converter, attempt]);

  function selectScript(value: OriginalScript) {
    saveOriginalScript(value);
    setScript(value);
  }

  const displayScript: OriginalScript = script === 'simplified' && converter ? 'simplified' : 'traditional';
  return {
    script, displayScript, converter, selectScript,
    pending: script === 'simplified' && !converter && !error,
    error: script === 'simplified' && error,
    retry: () => setAttempt(value => value + 1),
  };
}
