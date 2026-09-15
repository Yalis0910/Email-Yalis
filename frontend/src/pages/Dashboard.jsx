import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  ArrowUpRight, 
  Sparkles,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { api } from '../api/client';

const CATEGORY_MAP = {
  dev_ops: '开发运维',
  ai_tools: 'AI 工具',
  productivity: '协同办公',
  finance: '财务支付',
  entertainment: '影音娱乐',
  ecommerce: '电商消费',
  social: '社交人脉',
  other: '其他平台'
};

export default function Dashboard({ selectedAccount, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOverview();
  }, [selectedAccount]);

  const loadOverview = async () => {
    try {
      setLoading(true);
      const res = await api.getOverview(selectedAccount);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ECharts Option: Yohaku Style Category Donut
  const getCategoryChartOption = () => {
    if (!data || !data.category_distribution || data.category_distribution.length === 0) {
      return {};
    }

    // Yohaku muted literary palette
    const yohakuColors = [
      '#c56473', // signature accent
      '#787670', // neutral tier
      '#a8a69f',
      '#5c5a55',
      '#8cbea3', // calm sage
      '#7090b3', // calm indigo
      '#c8a06b', // calm ochre
      '#403f3a'
    ];

    return {
      color: yohakuColors,
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} 项 ({d}%)',
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        textStyle: { color: 'var(--color-neutral-9)', fontSize: 12, fontFamily: 'var(--font-sans)' }
      },
      legend: {
        orient: 'vertical',
        right: 12,
        top: 'middle',
        textStyle: { color: 'var(--color-neutral-7)', fontSize: 11, fontFamily: 'var(--font-sans)' },
        itemGap: 8,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle'
      },
      series: [
        {
          name: '资产分类',
          type: 'pie',
          radius: ['52%', '76%'],
          center: ['38%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: 'var(--color-surface)',
            borderWidth: 2
          },
          label: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 5,
            label: { show: false }
          },
          data: data.category_distribution
        }
      ]
    };
  };

  // ECharts Option: Yohaku Minimalist Line Chart
  const getTimelineChartOption = () => {
    if (!data || !data.activity_timeline || data.activity_timeline.length === 0) {
      return {};
    }
    const dates = data.activity_timeline.map(item => item.display_date || item.date);
    const counts = data.activity_timeline.map(item => item.count);

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params || params.length === 0) return '';
          const p = params[0];
          const rawItem = data.activity_timeline[p.dataIndex] || {};
          const fullDate = rawItem.date ? `${rawItem.date} (${p.name})` : p.name;
          return `<div style="font-family: var(--font-sans); font-size: 11px;">
            <div style="color: var(--color-neutral-6); margin-bottom: 2px;">${fullDate}</div>
            <div style="font-weight: 500; color: var(--color-neutral-10); font-family: var(--font-mono);">
              往来邮件: <span style="color: #c56473;">${p.value}</span> 封
            </div>
          </div>`;
        },
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        textStyle: { color: 'var(--color-neutral-9)', fontSize: 12, fontFamily: 'var(--font-mono)' }
      },
      grid: {
        left: '2%',
        right: '3%',
        bottom: '2%',
        top: '12%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: 'var(--color-border)' } },
        axisTick: { show: false },
        axisLabel: { color: 'var(--color-neutral-6)', fontSize: 10, fontFamily: 'var(--font-mono)' }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: 'var(--color-border)', type: 'dashed' } },
        axisLabel: { color: 'var(--color-neutral-6)', fontSize: 10, fontFamily: 'var(--font-mono)' }
      },
      series: [
        {
          name: '邮件往来',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: counts,
          itemStyle: { color: '#c56473' },
          lineStyle: { width: 1.8, color: '#c56473' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(197, 100, 115, 0.12)' },
                { offset: 1, color: 'rgba(197, 100, 115, 0.0)' }
              ]
            }
          }
        }
      ]
    };
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-2">
          <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-[var(--color-neutral-6)]">正在生成资产总览...</p>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: '收录邮件记录',
      value: data?.total_emails?.toLocaleString() || '0',
      unit: '封',
      subtitle: `来自 ${data?.total_accounts || 0} 个邮箱账号`,
      targetTab: 'emails'
    },
    {
      title: '数字资产台账',
      value: data?.total_digital_assets || '0',
      unit: '项',
      subtitle: 'SaaS 与平台注册凭据',
      targetTab: 'assets'
    },
    {
      title: '附件文件归档',
      value: `${data?.total_attachments || 0}`,
      unit: '个',
      subtitle: `累计占用 ${formatBytes(data?.total_attachment_size_bytes)}`,
      targetTab: 'attachments'
    },
  ];

  return (
    <div className="space-y-8 pb-16">
      {/* Yohaku Hero Eyebrow & Title */}
      <section className="border-b border-[var(--color-border)] pb-8 pt-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-neutral-6)]">
            邮件资产全景系统
          </span>
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
              邮件资产全景
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('emails')}
              className="yohaku-btn-secondary px-3.5 py-1.5 text-xs flex items-center gap-1.5"
            >
              <span>全文检索</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Mono Token Indicators */}
        <div className="flex flex-wrap gap-4 mt-6 text-xs font-mono text-[var(--color-neutral-6)] tabular-nums border-t border-[var(--color-border)]/60 pt-3">
          <span>收录邮件: <b className="text-[var(--color-neutral-9)] font-medium">{data?.total_emails || 0}</b></span>
          <span className="text-[var(--color-border)]">•</span>
          <span>服务平台: <b className="text-[var(--color-neutral-9)] font-medium">{data?.total_digital_assets || 0}</b></span>
          <span className="text-[var(--color-border)]">•</span>
          <span>附件大小: <b className="text-[var(--color-neutral-9)] font-medium">{formatBytes(data?.total_attachment_size_bytes)}</b></span>
        </div>
      </section>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            onClick={() => onNavigate(card.targetTab)}
            className="yohaku-card p-5 cursor-pointer group hover:-translate-y-0.5"
          >
            <div className="text-[11px] font-mono text-[var(--color-neutral-6)] tracking-wide">
              {card.title}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight tabular-nums">
                {card.value}
              </span>
              <span className="text-xs text-[var(--color-neutral-6)] font-mono">{card.unit}</span>
            </div>
            <div className="text-[11px] text-[var(--color-neutral-6)] mt-2 flex items-center justify-between">
              <span>{card.subtitle}</span>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--color-neutral-5)] group-hover:text-[var(--color-accent)] transition-colors" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Donut */}
        <div className="lg:col-span-5 yohaku-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">SaaS 与数字服务分类</h3>
              <p className="text-[11px] text-[var(--color-neutral-6)]">已解析服务类型分布</p>
            </div>
            <button
              onClick={() => onNavigate('assets')}
              className="text-xs text-[var(--color-accent)] hover:underline font-mono"
            >
              台账明细 &rarr;
            </button>
          </div>

          <div className="h-64">
            {data?.category_distribution?.length > 0 ? (
              <ReactECharts option={getCategoryChartOption()} style={{ height: '100%', width: '100%' }} />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[var(--color-neutral-5)] font-mono">
                暂无分类数据
              </div>
            )}
          </div>
        </div>

        {/* Right: Timeline Area */}
        <div className="lg:col-span-7 yohaku-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">邮件收发时序与活跃度</h3>
              <p className="text-[11px] text-[var(--color-neutral-6)]">近期历史节点分布</p>
            </div>
            <span className="text-[10px] font-mono text-[var(--color-neutral-6)] px-2 py-0.5 rounded bg-[var(--color-surface-subtle)]">
              近 30 节点
            </span>
          </div>

          <div className="h-64">
            {data?.activity_timeline?.length > 0 ? (
              <ReactECharts option={getTimelineChartOption()} style={{ height: '100%', width: '100%' }} />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[var(--color-neutral-5)] font-mono">
                暂无时序数据
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two Column Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Assets */}
        <div className="yohaku-card p-5">
          <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-3">
            <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">最新入库数字服务</h3>
            <button
              onClick={() => onNavigate('assets')}
              className="text-xs text-[var(--color-accent)] hover:underline font-mono"
            >
              查看全部
            </button>
          </div>

          <div className="divide-y divide-[var(--color-border)]/60">
            {data?.recent_assets?.length > 0 ? (
              data.recent_assets.map((asset) => (
                <div key={asset.id} className="py-3 flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-xs font-mono font-semibold text-[var(--color-accent)] shrink-0">
                      {asset.platform_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[var(--color-neutral-10)] flex items-center gap-1.5 truncate">
                        <span className="truncate">{asset.platform_name}</span>
                        {asset.domain && (
                          <span className="text-[10px] font-mono text-[var(--color-neutral-6)] truncate shrink-0">({asset.domain})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-neutral-6)] font-mono mt-0.5 truncate">
                        检测于 {asset.first_detected_at?.slice(0, 10) || '-'}
                      </div>
                    </div>
                  </div>

                  <span className="yohaku-tag shrink-0">
                    {CATEGORY_MAP[asset.category] || asset.category}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-[var(--color-neutral-5)] font-mono">暂无记录</div>
            )}
          </div>
        </div>

        {/* Top Contacts */}
        <div className="yohaku-card p-5">
          <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-3">
            <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">关键业务往来人脉</h3>
            <button
              onClick={() => onNavigate('contacts')}
              className="text-xs text-[var(--color-accent)] hover:underline font-mono"
            >
              关系图谱
            </button>
          </div>

          <div className="divide-y divide-[var(--color-border)]/60">
            {data?.top_contacts?.length > 0 ? (
              data.top_contacts.map((contact) => (
                <div 
                  key={contact.id} 
                  onClick={() => onNavigate('contacts', { contactId: contact.id, contact })}
                  className="py-3 flex items-center justify-between gap-2 min-w-0 cursor-pointer hover:bg-[var(--color-surface-subtle)] px-2 rounded-lg transition-colors group"
                  title="点击查看往来脉络"
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-xs font-mono font-medium text-[var(--color-neutral-8)] group-hover:bg-[var(--color-accent)] group-hover:text-white transition-all shrink-0">
                      {(contact.name || contact.email).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[var(--color-neutral-10)] group-hover:text-[var(--color-accent)] transition-colors truncate">
                        {contact.name || contact.email}
                      </div>
                      <div className="text-[11px] text-[var(--color-neutral-6)] font-mono truncate">
                        {contact.email}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono font-medium text-[var(--color-neutral-9)] tabular-nums">
                      {contact.inbound_count} 封信件
                    </div>
                    <div className="text-[10px] text-[var(--color-neutral-6)] font-mono">
                      最近: {contact.last_interaction || '-'}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-[var(--color-neutral-5)] font-mono">暂无记录</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
