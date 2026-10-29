import { useMemo, useState } from 'react';
import { Button, Empty } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { prettyText } from '../utils';

interface Props {
  text?: string;
  /** 内容为空时的提示 */
  emptyText?: string;
  maxHeight?: number;
}

/** 深色代码块：自动尝试 JSON 美化，并支持一键复制 */
export default function CodeBlock({ text, emptyText = '暂无内容', maxHeight = 320 }: Props) {
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => prettyText(text), [text]);

  if (!content) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ margin: '16px 0' }} />;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="nr-code-wrap">
      <Button
        className="nr-code-copy"
        size="small"
        type="text"
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={() => void copy()}
      >
        {copied ? '已复制' : '复制'}
      </Button>
      <pre className="nr-code" style={{ maxHeight }}>
        {content}
      </pre>
    </div>
  );
}
