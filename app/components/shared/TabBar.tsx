import { type ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
  badge?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  accentColor?: string;
}

export function TabBar({ tabs, activeTab, onTabChange, accentColor = '#3498db' }: TabBarProps) {
  const visibleTabs = tabs.filter((t) => !t.hidden);
  return (
    <div className="flex border-b border-white/[0.06] bg-[#0D1117]">
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`relative px-5 py-2.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === tab.id
              ? 'text-slate-200 border-b-2'
              : 'text-slate-500 hover:text-slate-400'
          }`}
          style={activeTab === tab.id ? { borderBottomColor: accentColor } : undefined}
        >
          {tab.icon}
          {tab.label}
          {tab.badge && activeTab !== tab.id && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#2563EB] animate-pulse" />
          )}
        </button>
      ))}
    </div>
  );
}
