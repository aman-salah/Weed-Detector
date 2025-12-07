import React from 'react';
import { LayoutDashboard, Upload, Camera, Sprout } from 'lucide-react';
import { AppView } from '../types';

interface NavbarProps {
  currentView: AppView;
  setView: (view: AppView) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, setView }) => {
  const navItems = [
    { id: AppView.DASHBOARD, label: 'Stats', icon: LayoutDashboard },
    { id: AppView.UPLOAD, label: 'Batch', icon: Upload },
    { id: AppView.LIVE, label: 'Live Vision', icon: Camera },
    { id: AppView.INSIGHTS, label: 'Eco-Advisor', icon: Sprout },
  ];

  return (
    <nav className="fixed bottom-6 left-1/2 transform -translate-x-1/2 glass-panel rounded-full px-2 py-2 z-50 flex space-x-2 shadow-2xl border border-white/50">
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => setView(item.id)}
          className={`flex items-center gap-2 px-5 py-3 rounded-full transition-all duration-300 ${
            currentView === item.id 
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' 
              : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-600'
          }`}
        >
          <item.icon size={20} />
          {currentView === item.id && (
            <span className="text-sm font-semibold tracking-wide animate-fadeIn whitespace-nowrap">
              {item.label}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
};