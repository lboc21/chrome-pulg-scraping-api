import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Popover, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined,
  DownloadOutlined,
  GlobalOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons';
import DetailDrawer from './components/DetailDrawer';
import SettingsPanel from './components/SettingsPanel';
import { ALL_METHODS, DEFAULT_CONFIG, countRecords, normalizeConfig, normalizeSiteInput } from '../shared/config';
import type { CapturedRequest, RecorderConfig, RecordsMap } from '../shared/types';
import { formatBytes, formatTime, hostOf, isThirdParty, recordSize, statusClass } from './utils';

const MAX_SEARCH_BODY = 2000;
const PAGE_SIZE = 50;

interface StateResponse {
  config?: RecorderConfig;
  records?: RecordsMap;
}

export default function App() {
  const [config, setConfig] = useState<RecorderConfig>(DEFAULT_CONFIG);
  const [records, setRecords] = useState<RecordsMap>({});
  const [siteInput, setSiteInput] = useState('');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [methods, setMethods] = useState<string[]>(ALL_METHODS);
  const [keyword, setKeyword] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageApi, messageHolder] = message.useMessage();

  const configRef = useRef(config);
  configRef.current = config;

  // ------------------------------------------------------------ 与 Service Worker 同步

  useEffect(() => {
    let alive = true;
    chrome.runtime
      .sendMessage({ type: 'GET_STATE' })
      .then((result: StateResponse | undefined) => {
        if (!alive) return;
        if (result?.config) setConfig(normalizeConfig(result.config));
        if (result?.records) setRecords(result.records);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes.records) setRecords((changes.records.newValue as RecordsMap) || {});
      if (changes.config) setConfig(normalizeConfig(changes.config.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const patchConfig = useCallback(
    async (patch: Partial<RecorderConfig>) => {
      const next = normalizeConfig({ ...configRef.current, ...patch });
      configRef.current = next;
      setConfig(next);
      try {
        await chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: next });
      } catch {
        messageApi.error('配置保存失败，请重试');
      }
    },
    [messageApi]
  );

  // ------------------------------------------------------------ 站点管理

  const addSite = () => {
    const host = normalizeSiteInput(siteInput);
    if (!host) {
      void messageApi.warning('请输入合法网址，例如 www.baidu.com');
      return;
    }
    if (configRef.current.sites.includes(host)) {
      void messageApi.info('该站点已在记录列表中');
      return;
    }
    setSiteInput('');
    void patchConfig({ sites: [...configRef.current.sites, host] });
    void messageApi.success(`已添加 ${host}，进入该网站后自动开始记录`);
  };

  const removeSite = (site: string) => {
    if (siteFilter === site) setSiteFilter('ALL');
    void patchConfig({ sites: configRef.current.sites.filter(item => item !== site) });
  };

  // ------------------------------------------------------------ 记录操作

  const clearRecords = async (site?: string) => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_RECORDS', site: site || null });
      void messageApi.success('已清空记录');
    } catch {
      void messageApi.error('清空失败，请重试');
    }
  };

  const allRecords = useMemo(() => Object.values(records).flat(), [records]);
  const total = useMemo(() => countRecords(records), [records]);

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allRecords
      .filter(item => siteFilter === 'ALL' || item.site === siteFilter)
      .filter(item => methods.includes(item.method))
      .filter(item => {
        if (!kw) return true;
        if (item.url.toLowerCase().includes(kw)) return true;
        if ((item.requestBody || '').slice(0, MAX_SEARCH_BODY).toLowerCase().includes(kw)) return true;
        return (item.responseBody || '').slice(0, MAX_SEARCH_BODY).toLowerCase().includes(kw);
      })
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [allRecords, siteFilter, methods, keyword]);

  const activeRecord = useMemo(() => allRecords.find(item => item.id === activeId) || null, [allRecords, activeId]);

  const toggleMethod = (method: string) => {
    setMethods(prev => {
      if (prev.includes(method)) return prev.length === 1 ? prev : prev.filter(item => item !== method);
      return ALL_METHODS.filter(item => prev.includes(item) || item === method);
    });
  };

  const exportJson = () => {
    const payload = { exportedAt: new Date().toISOString(), sites: config.sites, count: rows.length, records: rows };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `net-records-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  // ------------------------------------------------------------ 表格列

  const columns: ColumnsType<CapturedRequest> = [
    {
      title: '方法',
      dataIndex: 'method',
      width: 68,
      render: (value: string) => (
        <span className="nr-method" data-method={value}>
          {value}
        </span>
      )
    },
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
      render: (_value: string, record) => {
        const query = record.query.map(([name, value]) => `${name}=${value}`).join('&');
        const host = hostOf(record);
        return (
          <Tooltip
            placement="topLeft"
            mouseEnterDelay={0.3}
            title={<span style={{ fontSize: 11, wordBreak: 'break-all' }}>{record.url}</span>}
          >
            <div className="nr-url">
              {isThirdParty(record) ? <span className="nr-chip">三方</span> : null}
              <span className="nr-url-text">
                {host ? <span className="nr-url-host">{host}</span> : null}
                <span className="nr-url-path">{record.path || '/'}</span>
                {query ? <span className="nr-url-query">?{query}</span> : null}
              </span>
            </div>
          </Tooltip>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 60,
      render: (value: number | undefined, record) => (
        <span className={`nr-status ${statusClass(record)}`}>{value || (record.error ? 'ERR' : '-')}</span>
      )
    },
    {
      title: '类型',
      dataIndex: 'resourceType',
      width: 62,
      render: (value?: string) => <span className="nr-dim">{value === 'xmlhttprequest' ? 'xhr' : value || '-'}</span>
    },
    {
      title: '大小',
      width: 62,
      align: 'right' as const,
      render: (_value: unknown, record) => <span className="nr-dim">{formatBytes(recordSize(record))}</span>
    },
    {
      title: '耗时',
      width: 62,
      align: 'right' as const,
      render: (_value: unknown, record) => (
        <span className="nr-dim">{record.duration !== undefined ? `${record.duration}ms` : '-'}</span>
      )
    },
    {
      title: '次数',
      dataIndex: 'hitCount',
      width: 50,
      align: 'center' as const,
      render: (value: number) => (
        <Tooltip title={value > 1 ? `同一请求出现 ${value} 次，已用最后一次内容覆盖` : '仅出现过 1 次'}>
          <span className={`nr-hits ${value > 1 ? 'is-multi' : ''}`}>{value}</span>
        </Tooltip>
      )
    },
    {
      title: '时间',
      dataIndex: 'lastSeenAt',
      width: 72,
      align: 'right' as const,
      render: (value: number) => <span className="nr-time">{formatTime(value)}</span>
    }
  ];

  const filtering = methods.length !== ALL_METHODS.length || !!keyword.trim() || siteFilter !== 'ALL';
  const hasRecords = rows.length > 0;

  return (
    <div className="nr-app">
      {messageHolder}

      <header className="nr-topbar">
        <div className="nr-logo">N</div>
        <div className="nr-heading">
          <div className="nr-title">NetRecorder</div>
          <div className="nr-sub">
            共 {total} 条记录 · 当前筛选 {rows.length} 条
          </div>
        </div>
        <div className="nr-topbar-spacer" />
        <button
          type="button"
          className={`nr-toggle ${config.paused ? 'is-off' : ''}`}
          onClick={() => void patchConfig({ paused: !config.paused })}
          title={config.paused ? '点击继续记录' : '点击暂停记录'}
        >
          <span className="nr-state-dot" />
          {config.paused ? '已暂停' : '记录中'}
        </button>
        <div className="nr-actions">
          <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            title="记录设置"
            content={<SettingsPanel config={config} onChange={patch => void patchConfig(patch)} />}
          >
            <Button size="small" type="text" icon={<SettingOutlined />} />
          </Popover>
          <Tooltip title="导出当前列表为 JSON">
            <Button size="small" type="text" icon={<DownloadOutlined />} disabled={!hasRecords} onClick={exportJson} />
          </Tooltip>
          <Tooltip title={siteFilter === 'ALL' ? '清空全部记录' : `清空 ${siteFilter} 的记录`}>
            <Button
              size="small"
              type="text"
              danger
              icon={<ClearOutlined />}
              disabled={!hasRecords}
              onClick={() => void clearRecords(siteFilter === 'ALL' ? undefined : siteFilter)}
            />
          </Tooltip>
        </div>
      </header>

      <section className="nr-card nr-config">
        <div className="nr-add-row">
          <Input
            allowClear
            prefix={<GlobalOutlined />}
            placeholder="输入要监控的网址，如 www.baidu.com"
            value={siteInput}
            onChange={event => setSiteInput(event.target.value)}
            onPressEnter={addSite}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={addSite}>
            添加
          </Button>
        </div>
        <div className="nr-hint">
          {config.sites.length === 0
            ? '添加站点后，进入该网站发起的全部请求都会被自动记录（无需刷新扩展）'
            : '支持域名或完整链接，填写域名会自动匹配其子域名'}
        </div>
        {config.sites.length > 0 ? (
          <div className="nr-sites">
            <Tag
              className="nr-site-tag"
              color={siteFilter === 'ALL' ? 'blue' : undefined}
              onClick={() => setSiteFilter('ALL')}
            >
              全部站点
            </Tag>
            {config.sites.map(site => (
              <Tag
                key={site}
                className="nr-site-tag"
                color={siteFilter === site ? 'blue' : undefined}
                closable
                onClose={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeSite(site);
                }}
                onClick={() => setSiteFilter(siteFilter === site ? 'ALL' : site)}
              >
                {site}
              </Tag>
            ))}
          </div>
        ) : null}
      </section>

      <section className="nr-card nr-list">
        <div className="nr-toolbar">
          <div className="nr-mchips">
            {ALL_METHODS.map(method => (
              <button
                key={method}
                type="button"
                data-method={method}
                className={`nr-mchip ${methods.includes(method) ? 'is-on' : ''}`}
                onClick={() => toggleMethod(method)}
                title={`${methods.includes(method) ? '取消' : '显示'} ${method}`}
              >
                {method}
              </button>
            ))}
          </div>
          <Input
            className="nr-search"
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 URL / 参数 / 响应"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
        </div>

        <Table<CapturedRequest>
          className="nr-table"
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{
            size: 'small',
            pageSize: PAGE_SIZE,
            showSizeChanger: false,
            hideOnSinglePage: true,
            showTotal: value => `${value} 条`
          }}
          scroll={{ x: 760, y: 320 }}
          rowClassName={record => (record.id === activeId ? 'nr-row-active' : '')}
          onRow={record => ({ onClick: () => setActiveId(record.id) })}
          locale={{
            emptyText:
              config.sites.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ fontSize: 11.5, color: '#98a2b3' }}>
                      先在上方添加一个网址，再打开该网站即可自动记录
                    </span>
                  }
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ fontSize: 11.5, color: '#98a2b3' }}>
                      {filtering ? '当前筛选条件下没有记录' : '暂无记录，刷新目标页面试试'}
                    </span>
                  }
                />
              )
          }}
        />

        {hasRecords && rows.length <= PAGE_SIZE ? (
          <div className="nr-list-footer">
            <span>已显示全部 {rows.length} 条记录</span>
            <span>同一请求只保留一条 · 重复时用最新内容覆盖</span>
          </div>
        ) : null}
      </section>

      <DetailDrawer record={activeRecord} onClose={() => setActiveId(null)} />
    </div>
  );
}
