import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function Growth() {
  const { currentWorkspace, getHeaders } = useWorkspace();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    source: '',
    notes: ''
  });

  useEffect(() => {
    if (currentWorkspace) {
      loadLeads();
    } else {
      setLoading(false);
    }
  }, [currentWorkspace]);

  const loadLeads = async () => {
    try {
      const response = await axios.get(`${API_URL}/growth/leads`, {
        headers: getHeaders()
      });
      setLeads(response.data);
    } catch (error) {
      console.error('Failed to load leads:', error);
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLead = async (e) => {
    e.preventDefault();

    try {
      await axios.post(
        `${API_URL}/growth/leads`,
        formData,
        { headers: getHeaders() }
      );
      toast.success('Lead created successfully');
      setCreateDialogOpen(false);
      setFormData({ name: '', email: '', phone: '', source: '', notes: '' });
      loadLeads();
    } catch (error) {
      toast.error('Failed to create lead');
      console.error(error);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      LEAD: 'bg-blue-100 text-blue-800',
      PROSPECT: 'bg-purple-100 text-purple-800',
      CUSTOMER: 'bg-green-100 text-green-800',
      LOST: 'bg-gray-100 text-gray-600'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const statusCounts = {
    LEAD: leads.filter(l => l.status === 'LEAD').length,
    PROSPECT: leads.filter(l => l.status === 'PROSPECT').length,
    CUSTOMER: leads.filter(l => l.status === 'CUSTOMER').length
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="growth-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center" style={{ fontFamily: 'Space Grotesk' }}>
            <TrendingUp className="mr-3 text-green-500" size={32} />
            Growth AI
          </h1>
          <p className="text-gray-600">Manage your leads and grow your customer base</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="create-lead-btn">
          <Plus className="mr-2" size={18} />
          New Lead
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Leads</p>
                <p className="text-3xl font-bold">{leads.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="text-blue-600" size={24} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600 mb-1">New Leads</p>
            <p className="text-3xl font-bold">{statusCounts.LEAD}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600 mb-1">Prospects</p>
            <p className="text-3xl font-bold">{statusCounts.PROSPECT}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600 mb-1">Customers</p>
            <p className="text-3xl font-bold">{statusCounts.CUSTOMER}</p>
          </CardContent>
        </Card>
      </div>

      {/* Leads Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Leads</CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600 mb-4">No leads yet</p>
              <Button onClick={() => setCreateDialogOpen(true)} data-testid="empty-create-lead-btn">
                Add Your First Lead
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-sm">Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Phone</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Source</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, index) => (
                    <tr key={lead.id} className="border-b hover:bg-gray-50" data-testid={`lead-row-${index}`}>
                      <td className="py-3 px-4 font-medium">{lead.name}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{lead.email}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{lead.phone || '-'}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{lead.source || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(lead.status)}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Lead Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateLead} className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                data-testid="lead-name-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="lead-email-input"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="phone">Phone (Optional)</Label>
              <Input
                id="phone"
                data-testid="lead-phone-input"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="source">Source (Optional)</Label>
              <Input
                id="source"
                data-testid="lead-source-input"
                placeholder="e.g., Website, Referral, LinkedIn"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                data-testid="lead-notes-input"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                data-testid="cancel-lead-btn"
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="submit-lead-btn">
                Add Lead
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
