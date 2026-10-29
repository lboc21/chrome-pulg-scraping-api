import { Descriptions, Drawer, Table, Tabs, Typography } from 'antd';
import CodeBlock from './CodeBlock';
import type { CapturedRequest } from '../../shared/types';
import { formatBytes, formatDateTime, formatTime, headersEntries, recordSize, statusClass } from '../utils';

const { Text } = Typography;

interface Props {
  record: CapturedRequest | null;
  onClose: () => void;
}

function KeyValueTable({ rows, emptyText }: { rows: Array<{ name: string; value: string }>; emptyText: string }) {
  return (
    <Table
      className="nr-kv-table"
      size="small"
      bordered
      rowKey={(row, index) => `${row.name}-${index}`}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText }}
      columns={[
        {
          title: '名称',
          dataIndex: 'name',
          width: 190,
          render: (value: string) => <Text copyable={false}>{value}</Text>
        },
        {
          title: '值',
          dataIndex: 'value',
          render: (value: string) => (
            <Text
              style={{ fontSize: 12, wordBreak: 'break-all' }}
              copyable={value.length > 40 ? { text: value } : false}
            >
              {value}
            </Text>
          )
        }
      ]}
    />
  );
}

export default function DetailDrawer({ record, onClose }: Props) {
  const queryRows = (record?.query || []).map(([name, value]) => ({ name, value }));

  return (
    <Drawer
      open={!!record}
      onClose={onClose}
      width={760}
      placement="right"
      styles={{ body: { paddingTop: 12 } }}
      title={
        record ? (
          <div className="nr-drawer-title">
            <span className="nr-method" data-method={record.method}>
              {record.method}
            </span>
            <span className="nr-drawer-url" title={record.url}>
              {record.url}
            </span>
          </div>
        ) : (
          '请求详情'
        )
      }
      extra={
        record ? (
          <span className="nr-time" title={formatDateTime(record.lastSeenAt)}>
            {formatTime(record.lastSeenAt)}
          </span>
        ) : null
      }
    >
      {record && (
        <Tabs
          size="small"
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="请求方法">
                    <span className="nr-method" data-method={record.method}>
                      {record.method}
                    </span>
                    {record.resourceType ? (
                      <span className="nr-dim" style={{ marginLeft: 6 }}>
                        {record.resourceType}
                      </span>
                    ) : null}
                  </Descriptions.Item>
                  <Descriptions.Item label="完整 URL">
                    <Text style={{ fontSize: 12, wordBreak: 'break-all' }} copyable>
                      {record.url}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <span className={`nr-status ${statusClass(record)}`}>
                      {record.status || (record.error ? 'ERR' : '-')}
                    </span>
                    {record.statusText ? (
                      <span className="nr-dim" style={{ marginLeft: 6 }}>
                        {record.statusText}
                      </span>
                    ) : null}
                  </Descriptions.Item>
                  <Descriptions.Item label="Content-Type">
                    <Text style={{ fontSize: 12 }}>{record.contentType || '-'}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="响应大小">{formatBytes(recordSize(record))}</Descriptions.Item>
                  <Descriptions.Item label="耗时">
                    {record.duration !== undefined ? `${record.duration} ms` : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="命中次数">
                    <span className={`nr-hits ${record.hitCount > 1 ? 'is-multi' : ''}`}>{record.hitCount}</span>
                    <span className="nr-dim" style={{ marginLeft: 6 }}>
                      重复出现时以最后一次内容覆盖
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="首次出现">{formatDateTime(record.firstSeenAt)}</Descriptions.Item>
                  <Descriptions.Item label="最近一次">{formatDateTime(record.lastSeenAt)}</Descriptions.Item>
                  <Descriptions.Item label="归属站点">{record.site}</Descriptions.Item>
                  <Descriptions.Item label="发起页面">
                    <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{record.pageUrl || '-'}</Text>
                  </Descriptions.Item>
                  {record.error ? (
                    <Descriptions.Item label="错误">
                      <Text type="danger" style={{ fontSize: 12 }}>
                        {record.error}
                      </Text>
                    </Descriptions.Item>
                  ) : null}
                </Descriptions>
              )
            },
            {
              key: 'request',
              label: `请求参数${queryRows.length ? ` (${queryRows.length})` : ''}`,
              children: (
                <div className="nr-drawer-body">
                  <div className="nr-sub-title">Query 参数</div>
                  <KeyValueTable rows={queryRows} emptyText="该请求没有 Query 参数" />
                  <div className="nr-sub-title">请求体</div>
                  <CodeBlock text={record.requestBody} emptyText="该请求没有请求体（或无法读取）" />
                </div>
              )
            },
            {
              key: 'response',
              label: '响应内容',
              children: (
                <CodeBlock
                  text={record.responseBody}
                  emptyText="未捕获到响应体（非文本响应或未开启记录）"
                  maxHeight={430}
                />
              )
            },
            {
              key: 'headers',
              label: '标头',
              children: (
                <div className="nr-drawer-body">
                  <div className="nr-sub-title">请求头</div>
                  <KeyValueTable rows={headersEntries(record.requestHeaders)} emptyText="未获取到请求头" />
                  <div className="nr-sub-title">响应头</div>
                  <KeyValueTable rows={headersEntries(record.responseHeaders)} emptyText="未获取到响应头" />
                </div>
              )
            }
          ]}
        />
      )}
    </Drawer>
  );
}
