import React, { useState, useEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { Network, Users, Search, ArrowDownUp, ExternalLink, ChevronRight, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import ContactTimelineDrawer from '../components/ContactTimelineDrawer';

export default function ContactGraph({ selectedAccount, onSelectEmail }) {
  const [graphData, setGraphData] = useState({ nodes: [], links: [], categories: [] });
  const [contacts, setContacts] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contactLoading, setContactLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('weight'); // 'weight' | 'recent'
  const [selectedContactForTimeline, setSelectedContactForTimeline] = useState(null);
  const [isReportOpenDirectly, setIsReportOpenDirectly] = useState(false);

  const handleCloseTimeline = useCallback(() => {
    setSelectedContactForTimeline(null);
    setIsReportOpenDirectly(false);
  }, []);

  const handleSelectContact = useCallback((newContact) => {
    setSelectedContactForTimeline(newContact);
  }, []);

  useEffect(() => {
    loadGraph();
  }, [selectedAccount]);

  useEffect(() => {
    loadContacts();
  }, [selectedAccount, search, sortBy]);

  const loadGraph = async () => {
    try {
      setLoading(true);
      const res = await api.getContactsGraph(selectedAccount, 40);

      // Customize node styles for Yohaku calm palette
      if (res && res.nodes) {
        res.nodes = res.nodes.map(n => {
          if (n.category === 0) {
            // Root
            n.itemStyle = { color: '#c56473' };
          } else if (n.category === 1) {
            // Domain
            n.itemStyle = { color: '#5c5a55' };
          } else {
            // Contact
            n.itemStyle = { color: '#a8a69f' };
          }
          return n;
        });
      }

      setGraphData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async () => {
    try {
      setContactLoading(true);
      const res = await api.getContacts({
        account_id: selectedAccount || '',
        search: search.trim() || undefined,
        sort_by: sortBy,
        limit: 80
      });
      setContacts(res.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setContactLoading(false);
    }
  };

  const handleOpenReportList = async () => {
    try {
      // Fetch summarized contacts according to current sortBy
      const res = await api.getSummarizedContacts(selectedAccount || undefined, sortBy);
      const items = res.items || [];
      if (items.length > 0) {
        const topSummary = items[0];
        const matched = contacts.find(c => c.id === topSummary.contact_id);
        const targetContact = matched || {
          id: topSummary.contact_id,
          account_id: topSummary.account_id,
          email: topSummary.email,
          name: topSummary.name,
          domain: topSummary.domain,
          inbound_count: topSummary.inbound_count,
          outbound_count: topSummary.outbound_count,
          first_interaction: topSummary.first_interaction,
          last_interaction: topSummary.last_interaction,
          weight: topSummary.weight
        };
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(targetContact);
      } else if (contacts.length > 0) {
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(contacts[0]);
      } else {
        alert('暂无联系人数据');
      }
    } catch (err) {
      console.error('Failed to open report list:', err);
      if (contacts.length > 0) {
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(contacts[0]);
      }
    }
  };

  const onChartClick = (params) => {
    if (params.dataType === 'node') {
      setSelectedNode(params.data);
      const nodeName = (params.data.name || '').toLowerCase();
      // Match contact by name, email, or domain
      const matched = contacts.find(c =>
        (c.name && c.name.toLowerCase() === nodeName) ||
        (c.email && c.email.toLowerCase() === nodeName) ||
        (c.domain && c.domain.toLowerCase() === nodeName)
      );
      if (matched) {
        setIsReportOpenDirectly(false);
        setSelectedContactForTimeline(matched);
      }
    }
  };

  const getGraphOption = () => {
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          if (params.dataType === 'node') {
            return `<b>${params.name}</b><br/>分类: ${graphData.categories[params.data.category]?.name || '联系人'}<br/>交互强度: ${params.value || 1}`;
          }
          return `人脉往来关联`;
        },
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        textStyle: { color: 'var(--color-neutral-9)', fontSize: 12, fontFamily: 'var(--font-sans)' }
      },
      legend: {
        data: graphData.categories.map(c => c.name),
        textStyle: { color: 'var(--color-neutral-6)', fontSize: 11, fontFamily: 'var(--font-sans)' },
        top: 12,
        left: 12,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle'
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          data: graphData.nodes,
          links: graphData.links,
          categories: graphData.categories,
          roam: true,
          label: {
            show: true,
            position: 'right',
            formatter: '{b}',
            color: 'var(--color-neutral-7)',
            fontSize: 10,
            fontFamily: 'var(--font-mono)'
          },
          force: {
            repulsion: 200,
            edgeLength: [60, 130],
            gravity: 0.08
          },
          lineStyle: {
            color: 'var(--color-neutral-4)',
            curveness: 0.15,
            opacity: 0.4
          },
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 2.5, opacity: 0.9 }
          }
        }
      ]
    };
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] pb-4 pt-2">
        <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
          人脉网络拓扑图谱
        </h1>
        <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
          基于往来信件发收频次与机构域名聚类构建的动态关系网络。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Canvas */}
        <div className="lg:col-span-8 yohaku-card p-5 flex flex-col justify-between h-[600px] relative">
          <div className="flex items-center justify-between z-10">
            <span className="text-xs font-mono text-[var(--color-neutral-6)]">力导向拓扑（可缩放与拖拽）</span>
            <span className="text-xs font-mono text-[var(--color-accent)] tabular-nums">节点数: {graphData.nodes.length}</span>
          </div>

          <div className="flex-1 w-full h-full">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : graphData.nodes.length > 0 ? (
              <ReactECharts
                option={getGraphOption()}
                style={{ height: '100%', width: '100%' }}
                onEvents={{ click: onChartClick }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs font-mono text-[var(--color-neutral-5)]">
                暂无足够数据构建图谱
              </div>
            )}
          </div>

          {selectedNode && (
            <div className="absolute bottom-4 left-4 z-20 yohaku-card p-3 shadow-md max-w-xs text-xs">
              <div className="flex items-center justify-between text-[var(--color-neutral-5)] mb-1">
                <span className="font-mono text-[10px]">选中节点</span>
                <button onClick={() => setSelectedNode(null)} className="hover:text-[var(--color-neutral-9)]">&times;</button>
              </div>
              <div className="font-medium text-[var(--color-neutral-10)] text-sm">{selectedNode.name}</div>
              <div className="text-[var(--color-neutral-6)] font-mono text-[11px] mt-1">
                类型: {graphData.categories[selectedNode.category]?.name}
              </div>
              {(() => {
                const nodeName = (selectedNode.name || '').toLowerCase();
                const matched = contacts.find(c =>
                  (c.name && c.name.toLowerCase() === nodeName) ||
                  (c.email && c.email.toLowerCase() === nodeName) ||
                  (c.domain && c.domain.toLowerCase() === nodeName)
                );
                if (matched) {
                  return (
                    <button
                      onClick={() => setSelectedContactForTimeline(matched)}
                      className="mt-2 text-xs font-mono text-[var(--color-accent)] hover:underline flex items-center gap-1"
                    >
                      <span>打开往来交流脉络图</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>

        {/* Right Contacts Rank list */}
        <div className="lg:col-span-4 yohaku-card p-5 flex flex-col justify-between h-[600px]">
          <div className="flex flex-col h-full min-h-0">
            {/* Header Title */}
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[var(--color-border)] flex-shrink-0">
              <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--color-neutral-8)] font-medium flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>核心往来联系人</span>
              </h3>
              <button
                onClick={handleOpenReportList}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-[var(--color-accent)] text-white hover:opacity-90 shadow-2xs transition-all cursor-pointer"
                title="直接展开已总结的 AI 画像报告列表与详情"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>报告列表</span>
              </button>
            </div>

            {/* Search Box */}
            <div className="relative mb-2.5 flex-shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
              <input
                type="text"
                placeholder="搜索姓名、邮箱或域名..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-neutral-5)]"
              />
            </div>

            {/* Sorting Switcher */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border)]/60 text-xs font-mono flex-shrink-0">
              <span className="text-[11px] text-[var(--color-neutral-6)] tabular-nums">
                {contacts.length} 位联系人
              </span>
              <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[10px]">
                <button
                  onClick={() => setSortBy('weight')}
                  className={`px-2 py-0.5 rounded transition-all ${
                    sortBy === 'weight'
                      ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                      : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                  }`}
                >
                  按频次
                </button>
                <button
                  onClick={() => setSortBy('recent')}
                  className={`px-2 py-0.5 rounded transition-all ${
                    sortBy === 'recent'
                      ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                      : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                  }`}
                >
                  按最近
                </button>
              </div>
            </div>

            {/* Contacts Scrollable List */}
            <div className="space-y-1 overflow-y-auto flex-1 pr-1 divide-y divide-[var(--color-border)]/40">
              {contactLoading && contacts.length === 0 ? (
                <div className="py-20 text-center text-xs font-mono text-[var(--color-neutral-5)]">
                  正在加载联系人...
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-20 text-center text-xs font-mono text-[var(--color-neutral-5)]">
                  未匹配到相关联系人
                </div>
              ) : (
                contacts.map((c, i) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setIsReportOpenDirectly(false);
                      setSelectedContactForTimeline(c);
                    }}
                    className="pt-2 pb-1.5 px-2 rounded-lg cursor-pointer transition-all hover:bg-[var(--color-surface-subtle)] group flex items-center justify-between"
                    title="点击查看历史交流脉络流程图"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="text-[10px] font-mono text-[var(--color-neutral-5)] w-4 tabular-nums flex-shrink-0">
                        {i + 1}.
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--color-neutral-10)] truncate max-w-[130px] group-hover:text-[var(--color-accent)] transition-colors">
                          {c.name || c.email}
                        </div>
                        <div className="text-[10px] text-[var(--color-neutral-6)] font-mono truncate max-w-[130px]">
                          {c.domain || c.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 font-mono">
                      <div className="text-right">
                        <div className="text-xs font-medium text-[var(--color-accent)] tabular-nums">
                          {c.inbound_count + c.outbound_count} 封
                        </div>
                        <div className="text-[9px] text-[var(--color-neutral-5)]">
                          {c.last_interaction ? c.last_interaction.slice(5) : `权重 ${c.weight.toFixed(1)}`}
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--color-neutral-4)] group-hover:text-[var(--color-accent)] group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contact Timeline Drawer */}
      <ContactTimelineDrawer
        contact={selectedContactForTimeline}
        isOpen={!!selectedContactForTimeline}
        onClose={handleCloseTimeline}
        onSelectEmail={onSelectEmail}
        onSelectContact={handleSelectContact}
        defaultReportOpen={isReportOpenDirectly}
        sortBy={sortBy}
      />
    </div>
  );
}
