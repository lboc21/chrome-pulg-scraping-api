import { useEffect, useState } from 'react';
import { Input, Segmented, Switch } from 'antd';
import type { DedupeMode, RecorderConfig } from '../../shared/types';

interface Props {
  config: RecorderConfig;
  onChange: (patch: Partial<RecorderConfig>) => void;
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="nr-set-row">
      <div>
        <div className="nr-set-row-title">{label}</div>
        {hint ? <div className="nr-set-row-hint">{hint}</div> : null}
      </div>
      <Switch size="small" checked={checked} onChange={onChange} style={{ marginTop: 2, flex: 'none' }} />
    </div>
  );
}

export default function SettingsPanel({ config, onChange }: Props) {
  const [ignoreText, setIgnoreText] = useState(config.ignoreParams.join(', '));

  useEffect(() => {
    setIgnoreText(config.ignoreParams.join(', '));
  }, [config.ignoreParams]);

  const commitIgnore = () => {
    const next = ignoreText
      .split(/[,，\s]+/)
      .map(item => item.trim())
      .filter(Boolean);
    onChange({ ignoreParams: Array.from(new Set(next)) });
  };

  return (
    <div className="nr-settings">
      <div className="nr-set-block">
        <div className="nr-set-label">去重模式</div>
        <Segmented
          size="small"
          block
          value={config.dedupeMode}
          onChange={value => onChange({ dedupeMode: value as DedupeMode })}
          options={[
            { label: '宽松', value: 'loose' },
            { label: '严格', value: 'strict' }
          ]}
        />
        <div className="nr-set-hint">宽松：参数顺序、动态参数不同仍算同一请求；严格：URL 完全一致才算同一请求</div>
      </div>

      <div className="nr-set-divider" />

      <div className="nr-set-list">
        <SwitchRow
          label="记录请求体"
          hint="POST / PUT / PATCH 的 body"
          checked={config.captureRequestBody}
          onChange={value => onChange({ captureRequestBody: value })}
        />
        <SwitchRow
          label="记录响应内容"
          hint="hook fetch / XHR，仅文本类响应"
          checked={config.captureResponseBody}
          onChange={value => onChange({ captureResponseBody: value })}
        />
        <SwitchRow
          label="包含静态资源"
          hint="js / css / 图片 / 字体等"
          checked={config.includeStatic}
          onChange={value => onChange({ includeStatic: value })}
        />
      </div>

      <div className="nr-set-divider" />

      <div className="nr-set-block">
        <div className="nr-set-label">忽略的动态参数名</div>
        <Input.TextArea
          size="small"
          value={ignoreText}
          onChange={event => setIgnoreText(event.target.value)}
          onBlur={commitIgnore}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="_t, timestamp, nonce"
        />
        <div className="nr-set-hint">这些参数不参与去重，逗号分隔</div>
      </div>
    </div>
  );
}
