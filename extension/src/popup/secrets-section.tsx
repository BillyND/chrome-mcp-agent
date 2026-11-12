// Popup section where the user keeps secrets (passwords, API keys) for the AI to use as
// {{secret:NAME}}. Values go straight into chrome.storage.local and are never shown again or
// sent anywhere: the model only ever sees the names.

import { useEffect, useState } from 'react';
import { isValidSecret, MIN_SECRET_LENGTH, normalizeSecretName, type Secrets } from '../background/secrets/redact';
import { t, type Key, type Lang } from '../i18n';
import { Button, Collapsible, Input } from './ui/components';

const KEY = 'secrets';

const read = async (): Promise<Secrets> => ((await chrome.storage.local.get(KEY))[KEY] as Secrets | undefined) ?? {};

export function SecretsSection({ lang }: { lang: Lang }) {
  const tr = (k: Key) => t(lang, k);
  const [secrets, setSecrets] = useState<Secrets>({});
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    void read().then(setSecrets);
  }, []);

  const store = async (next: Secrets) => {
    await chrome.storage.local.set({ [KEY]: next });
    setSecrets(next);
  };
  const save = async () => {
    const key = normalizeSecretName(name);
    if (!isValidSecret(key, value)) return setInvalid(true);
    setInvalid(false);
    await store({ ...(await read()), [key]: value });
    setName('');
    setValue('');
  };
  const remove = async (key: string) => {
    const { [key]: _gone, ...rest } = await read();
    await store(rest);
  };
  const names = Object.keys(secrets);

  return (
    <Collapsible id="secrets" title={tr('secrets')} count={names.length}>
      <div className="text-[13px] text-muted-foreground">{tr('secretsHint')}</div>
      <ul className="divide-y rounded-lg border">
        {names.length === 0 && <li className="px-2.5 py-2 text-center text-[13px] text-muted-foreground">{tr('noSecrets')}</li>}
        {names.map((n) => (
          <li key={n} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
            <code className="min-w-0 flex-1 truncate font-mono">{n}</code>
            <Button variant="link" size="sm" aria-label={`${tr('secretDelete')} ${n}`} onClick={() => void remove(n)}>
              {tr('secretDelete')}
            </Button>
          </li>
        ))}
      </ul>
      <Input id="secret-name" placeholder={tr('secretName')} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      <Input
        id="secret-value"
        type="password"
        placeholder={tr('secretValue')}
        value={value}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
      />
      {name && normalizeSecretName(name) !== name.trim() && <p className="text-[13px] text-muted-foreground">{tr('secretNameAs')} <code className="font-mono">{normalizeSecretName(name)}</code></p>}
      {value.length > 0 && value.length < MIN_SECRET_LENGTH && <p className="text-[13px] text-muted-foreground">{tr('secretShort')}</p>}
      {invalid && <p className="text-[13px] text-destructive">{tr('secretInvalid')}</p>}
      <Button id="secret-save" size="sm" onClick={() => void save()}>
        {tr('secretSave')}
      </Button>
    </Collapsible>
  );
}
