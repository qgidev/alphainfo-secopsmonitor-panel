import React, { useCallback, useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { IconButton, Input } from '@grafana/ui';

/**
 * Panel-options editor for the alphainfo API key.
 *
 * The key lives in the dashboard JSON unencrypted (Grafana Panel plugins
 * don't have access to `secureJsonData` — that's a Datasource-only
 * feature), so we cannot make it secret in the storage sense. What we
 * *can* do, and the reason this custom editor exists, is hide the key
 * visually by default: showing `ai_xxxxxxxx...` in plaintext during a
 * live demo, screen-share, or a screenshot attached to a ticket leaks
 * it. The default state here is masked, with a reveal toggle for when
 * the user needs to copy/edit it.
 */
export const ApiKeyEditor: React.FC<StandardEditorProps<string>> = ({ value, onChange, item }) => {
  const [revealed, setRevealed] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    [onChange],
  );

  const toggle = useCallback(() => setRevealed((v) => !v), []);

  return (
    <Input
      type={revealed ? 'text' : 'password'}
      value={value ?? ''}
      onChange={handleChange}
      placeholder={item?.settings?.placeholder ?? 'ai_...'}
      autoComplete="off"
      spellCheck={false}
      data-testid="alphainfo-apikey-input"
      suffix={
        <IconButton
          name={revealed ? 'eye-slash' : 'eye'}
          tooltip={revealed ? 'Hide API key' : 'Show API key'}
          onClick={toggle}
          aria-label={revealed ? 'Hide API key' : 'Show API key'}
          data-testid="alphainfo-apikey-reveal"
        />
      }
    />
  );
};
