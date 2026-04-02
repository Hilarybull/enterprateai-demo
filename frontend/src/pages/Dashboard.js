import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lightbulb, FileText, Users, TrendingUp, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function Dashboard() {
  const { currentWorkspace, getHeaders } = useWorkspace();
  const [stats, setStats] = useState({
    genesisProjects: 0,
    invoices: 0,
    unpaidInvoices: 0,
    leads: 0
  });
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentWorkspace) {
      loadDashboardData();
    } else {
      setLoading(false);
    }
  }, [currentWorkspace]);

  const loadDashboardData = async () => {
    try {
      const headers = getHeaders();

      // Load projects
      const projectsRes = await axios.get(
        `${API_URL}/workspaces/${currentWorkspace.id}/projects`,
        { headers }
      );
      const genesisProjects = projectsRes.data.filter(p => p.type === 'GENESIS');

      // Load invoices
      const invoicesRes = await axios.get(`${API_URL}/navigator/invoices`, { headers });
      const unpaid = invoicesRes.data.filter(inv => inv.status !== 'PAID' && inv.status !== 'CANCELLED');

      // Load leads
      const leadsRes = await axios.get(`${API_URL}/growth/leads`, { headers });

      // Load recent events
      const eventsRes = await axios.get(`${API_URL}/intel/events?limit=10`, { headers });

      setStats({
        genesisProjects: genesisProjects.length,
        invoices: invoicesRes.data.length,
        unpaidInvoices: unpaid.length,
        leads: leadsRes.data.length
      });

      setRecentEvents(eventsRes.data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Genesis Projects',
      value: stats.genesisProjects,
      icon: Lightbulb,
      color: 'from-yellow-400 to-orange-500',
      link: '/genesis'
    },
    {
      title: 'Total Invoices',
      value: stats.invoices,
      subtitle: `${stats.unpaidInvoices} unpaid`,
      icon: FileText,
      color: 'from-blue-400 to-blue-600',
      link: '/navigator'
    },
    {
      title: 'Leads',
      value: stats.leads,
      icon: Users,
      color: 'from-green-400 to-emerald-600',
      link: '/growth'
    },
    {
      title: 'Growth Rate',
      value: '+12%',
      subtitle: 'vs last month',
      icon: TrendingUp,
      color: 'from-purple-400 to-pink-600',
      link: '/growth'
    }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="no-workspace">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">No Workspace Selected</h2>
            <p className="text-gray-600 mb-4">
              Please create a workspace to get started using EnterprateAI.
            </p>
            <p className="text-sm text-gray-500">
              Click the workspace selector in the top navigation to create your first workspace.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="dashboard">
      <div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk' }}>
          Welcome back!
        </h1>
        <p className="text-gray-600">Here's what's happening with {currentWorkspace?.name}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Link key={index} to={stat.link}>
              <Card className="card-hover cursor-pointer" data-testid={`stat-card-${index}`}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{stat.title}</p>
                      <p className="text-3xl font-bold mb-1">{stat.value}</p>
                      {stat.subtitle && (
                        <p className="text-sm text-gray-500">{stat.subtitle}</p>
                      )}
                    </div>
                    <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-lg flex items-center justify-center`}>
                      <Icon className="text-white" size={24} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="mr-2" size={20} />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No recent activity</p>
          ) : (
            <div className="space-y-4">
              {recentEvents.map((event, index) => (
                <div
                  key={event.id || index}
                  className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50"
                  data-testid={`event-${index}`}
                >
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{formatEventType(event.type)}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(event.occurredAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatEventType(type) {
  const formatted = type.replace(/_/g, ' ').replace(/\./g, ' - ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
