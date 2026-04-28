"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { AnalyticsCard } from "@/components/AnalyticsCard";
import { KeyUsageTable } from "@/components/KeyUsageTable";
import { QueryList } from "@/components/QueryList";
import { ProviderStatsChart } from "@/components/ProviderStatsChart";
import { MetricsChart } from "@/components/MetricsChart";
import { Activity, Clock, AlertTriangle, Key, Search, Server, ShieldCheck, Zap } from "lucide-react";

export default function AnalyticsPage() {
  const { data: stats, error: statsError } = useSWR(`http://localhost:3001/api/stats`, fetcher, { refreshInterval: 10000 });
  const { data: history, error: historyError } = useSWR(`http://localhost:3001/api/stats/history`, fetcher, { refreshInterval: 30000 });

  if (statsError) {
    return (
      <main className="container mx-auto p-8 max-w-screen-2xl">
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-500 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <div>
            <h3 className="font-semibold">Failed to load analytics</h3>
            <p className="text-sm">Unable to connect to the metrics endpoint. Ensure the proxy service is running.</p>
          </div>
        </div>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="container mx-auto p-8 max-w-screen-2xl flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Activity className="w-8 h-8 animate-pulse" />
          <p>Loading analytics...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-8 max-w-screen-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usage Analytics</h1>
          <p className="text-gray-400 mt-2">Real-time usage and performance intelligence.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-card border border-border/50 px-3 py-1.5 rounded-full">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          Live Updates Active
        </div>
      </div>

      {/* 1. System Overview */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-blue-500" />
          System Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <AnalyticsCard 
            title="Total Requests" 
            value={stats.requests.total.toLocaleString()} 
            icon={<Activity className="w-4 h-4" />}
          />
          <AnalyticsCard 
            title="Requests / Min" 
            value={stats.requests.perMinute} 
            subtitle="Current active load"
            icon={<Zap className="w-4 h-4 text-yellow-500" />}
          />
          <AnalyticsCard 
            title="Error Rate" 
            value={`${(stats.errors.rate * 100).toFixed(2)}%`} 
            subtitle={`${stats.errors.count} total errors`}
            icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
          />
          <AnalyticsCard 
            title="Avg Latency" 
            value={`${stats.latency.avgMs}ms`} 
            subtitle={`p95: ${stats.latency.p95Ms}ms`}
            icon={<Clock className="w-4 h-4 text-blue-400" />}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 2. API Key Usage & 3. Query Insights */}
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-500" />
              API Key Usage
            </h2>
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <KeyUsageTable apiKeys={stats.apikeys} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-500" />
              Load & Error Trends
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Requests Per Minute</h3>
                <MetricsChart 
                  data={history || []} 
                  dataKey="requestsPerMinute" 
                  color="#3b82f6" 
                  name="RPM" 
                />
              </div>
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Error Rate Trend</h3>
                <MetricsChart 
                  data={history || []} 
                  dataKey="errorRate" 
                  color="#ef4444" 
                  name="Error Rate" 
                />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-orange-500" />
              Top Queries
            </h2>
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <QueryList queries={stats.topQueries} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-teal-500" />
              Ranking Quality
            </h2>
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
              <div>
                <p className="text-sm text-gray-400 mb-1">Avg Top Confidence</p>
                <div className="text-3xl font-bold">{(stats.ranking.avgTopConfidence * 100).toFixed(1)}%</div>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-2">Score Distribution</p>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Excellent (≥0.8)</span>
                      <span>{stats.ranking.scoreDistribution.excellent}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min((stats.ranking.scoreDistribution.excellent / Math.max(1, stats.ranking.totalRankings)) * 100, 100)}%` }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Good (≥0.5)</span>
                      <span>{stats.ranking.scoreDistribution.good}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min((stats.ranking.scoreDistribution.good / Math.max(1, stats.ranking.totalRankings)) * 100, 100)}%` }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Poor ({"<"}0.5)</span>
                      <span>{stats.ranking.scoreDistribution.poor}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min((stats.ranking.scoreDistribution.poor / Math.max(1, stats.ranking.totalRankings)) * 100, 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-indigo-500" />
          Provider Performance
        </h2>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <ProviderStatsChart providers={stats.providers} />
        </div>
      </section>

    </main>
  );
}
