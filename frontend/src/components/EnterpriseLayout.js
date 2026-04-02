import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function EnterpriseLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-purple-50">
      <div className="flex">
        {/* Fixed Sidebar */}
        <Sidebar />
        
        {/* Main Content Area */}
        <main className="flex-1 ml-[280px] p-8">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
