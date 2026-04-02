import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function Settings() {
  const { currentWorkspace, getHeaders, loadWorkspaces } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    country: '',
    industry: '',
    stage: ''
  });

  useEffect(() => {
    if (currentWorkspace) {
      loadWorkspaceDetails();
    }
  }, [currentWorkspace]);

  const loadWorkspaceDetails = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/workspaces/${currentWorkspace.id}`,
        { headers: getHeaders() }
      );
      
      setFormData({
        name: response.data.name || '',
        country: response.data.country || '',
        industry: response.data.industry || '',
        stage: response.data.stage || ''
      });
    } catch (error) {
      console.error('Failed to load workspace details:', error);
      toast.error('Failed to load workspace details');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      await axios.patch(
        `${API_URL}/workspaces/${currentWorkspace.id}`,
        formData,
        { headers: getHeaders() }
      );
      toast.success('Workspace updated successfully');
      await loadWorkspaces();
    } catch (error) {
      toast.error('Failed to update workspace');
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in max-w-4xl" data-testid="settings-page">
      <div>
        <h1 className="text-3xl font-bold mb-2 flex items-center" style={{ fontFamily: 'Space Grotesk' }}>
          <SettingsIcon className="mr-3 text-gray-600" size={32} />
          Settings
        </h1>
        <p className="text-gray-600">Manage your workspace settings and preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Information</CardTitle>
          <CardDescription>
            Update your workspace details and business information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <Label htmlFor="name">Workspace Name</Label>
                <Input
                  id="name"
                  data-testid="workspace-name-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  data-testid="country-input"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                  placeholder="United States"
                />
              </div>

              <div>
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  data-testid="industry-input"
                  value={formData.industry}
                  onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  placeholder="Technology"
                />
              </div>

              <div className="md:col-span-2">
                <Label htmlFor="stage">Business Stage</Label>
                <Input
                  id="stage"
                  data-testid="stage-input"
                  value={formData.stage}
                  onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                  placeholder="Startup, Growth, Enterprise"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving} data-testid="save-settings-btn">
                <Save className="mr-2" size={18} />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace ID</CardTitle>
          <CardDescription>
            Use this ID for API integrations and webhooks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Input
              value={currentWorkspace?.id || ''}
              readOnly
              className="font-mono text-sm"
              data-testid="workspace-id-display"
            />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(currentWorkspace?.id || '');
                toast.success('Workspace ID copied to clipboard');
              }}
              data-testid="copy-workspace-id-btn"
            >
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
