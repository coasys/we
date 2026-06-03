/**
 * Mock graph data for testing
 */

import type { GraphData } from './GraphWidget.types';

export const mockGraphData: GraphData = {
  nodes: [
    // Users
    {
      id: 'user-1',
      type: 'user',
      label: 'Sarah Chen',
      avatar: 'https://i.pravatar.cc/150?img=5',
    },
    {
      id: 'user-2',
      type: 'user',
      label: 'Marcus Rodriguez',
      avatar: 'https://i.pravatar.cc/150?img=12',
    },
    {
      id: 'user-3',
      type: 'user',
      label: 'Elena Popov',
      avatar: 'https://i.pravatar.cc/150?img=9',
    },
    {
      id: 'user-4',
      type: 'user',
      label: 'James Wilson',
      avatar: 'https://i.pravatar.cc/150?img=3',
    },
    {
      id: 'user-5',
      type: 'user',
      label: 'Priya Sharma',
      avatar: 'https://i.pravatar.cc/150?img=16',
    },
    {
      id: 'user-6',
      type: 'user',
      label: 'Alex Kim',
      avatar: 'https://i.pravatar.cc/150?img=7',
    },
    {
      id: 'user-7',
      type: 'user',
      label: 'Isabella Martinez',
      avatar: 'https://i.pravatar.cc/150?img=10',
    },
    {
      id: 'user-8',
      type: 'user',
      label: 'David Zhang',
      avatar: 'https://i.pravatar.cc/150?img=15',
    },
    {
      id: 'user-9',
      type: 'user',
      label: 'Olivia Brown',
      avatar: 'https://i.pravatar.cc/150?img=20',
    },
    {
      id: 'user-10',
      type: 'user',
      label: 'Noah Anderson',
      avatar: 'https://i.pravatar.cc/150?img=8',
    },

    // Spaces
    {
      id: 'space-1',
      type: 'space',
      label: 'Design Team',
    },
    {
      id: 'space-2',
      type: 'space',
      label: 'Dev Team',
    },
    {
      id: 'space-3',
      type: 'space',
      label: 'Product Strategy',
    },
    {
      id: 'space-4',
      type: 'space',
      label: 'Marketing',
    },
    {
      id: 'space-5',
      type: 'space',
      label: 'Research Lab',
    },
    {
      id: 'space-6',
      type: 'space',
      label: 'Community',
    },

    // Posts
    {
      id: 'post-1',
      type: 'post',
      label: 'Design Systems Guide',
    },
    {
      id: 'post-2',
      type: 'post',
      label: 'Web3 UX Patterns',
    },
    {
      id: 'post-3',
      type: 'post',
      label: 'Animation Tips',
    },
    {
      id: 'post-4',
      type: 'post',
      label: 'TypeScript Features',
    },
    {
      id: 'post-5',
      type: 'post',
      label: 'Accessibility Matters',
    },
    {
      id: 'post-6',
      type: 'post',
      label: 'React Patterns',
    },
    {
      id: 'post-7',
      type: 'post',
      label: 'Performance Tips',
    },
    {
      id: 'post-8',
      type: 'post',
      label: 'CSS Grid Mastery',
    },
    {
      id: 'post-9',
      type: 'post',
      label: 'API Design Best Practices',
    },
    {
      id: 'post-10',
      type: 'post',
      label: 'GraphQL vs REST',
    },
  ],
  edges: [
    // User follows
    { id: 'e1', source: 'user-1', target: 'user-2', type: 'follows' },
    { id: 'e2', source: 'user-1', target: 'user-3', type: 'follows' },
    { id: 'e3', source: 'user-2', target: 'user-4', type: 'follows' },
    { id: 'e4', source: 'user-3', target: 'user-5', type: 'follows' },
    { id: 'e5', source: 'user-4', target: 'user-1', type: 'follows' },
    { id: 'e6', source: 'user-5', target: 'user-2', type: 'follows' },
    { id: 'e25', source: 'user-6', target: 'user-1', type: 'follows' },
    { id: 'e26', source: 'user-6', target: 'user-7', type: 'follows' },
    { id: 'e27', source: 'user-7', target: 'user-8', type: 'follows' },
    { id: 'e28', source: 'user-8', target: 'user-9', type: 'follows' },
    { id: 'e29', source: 'user-9', target: 'user-10', type: 'follows' },
    { id: 'e30', source: 'user-10', target: 'user-6', type: 'follows' },
    { id: 'e31', source: 'user-7', target: 'user-3', type: 'follows' },
    { id: 'e32', source: 'user-8', target: 'user-4', type: 'follows' },

    // Space memberships
    { id: 'e7', source: 'user-1', target: 'space-1', type: 'member-of' },
    { id: 'e8', source: 'user-2', target: 'space-1', type: 'member-of' },
    { id: 'e9', source: 'user-2', target: 'space-2', type: 'member-of' },
    { id: 'e10', source: 'user-3', target: 'space-2', type: 'member-of' },
    { id: 'e11', source: 'user-4', target: 'space-2', type: 'member-of' },
    { id: 'e12', source: 'user-4', target: 'space-3', type: 'member-of' },
    { id: 'e13', source: 'user-5', target: 'space-3', type: 'member-of' },
    { id: 'e33', source: 'user-6', target: 'space-1', type: 'member-of' },
    { id: 'e34', source: 'user-6', target: 'space-4', type: 'member-of' },
    { id: 'e35', source: 'user-7', target: 'space-4', type: 'member-of' },
    { id: 'e36', source: 'user-7', target: 'space-5', type: 'member-of' },
    { id: 'e37', source: 'user-8', target: 'space-2', type: 'member-of' },
    { id: 'e38', source: 'user-8', target: 'space-5', type: 'member-of' },
    { id: 'e39', source: 'user-9', target: 'space-6', type: 'member-of' },
    { id: 'e40', source: 'user-10', target: 'space-6', type: 'member-of' },
    { id: 'e41', source: 'user-10', target: 'space-3', type: 'member-of' },

    // Posts in spaces
    { id: 'e14', source: 'post-1', target: 'space-1', type: 'posted-in' },
    { id: 'e15', source: 'post-2', target: 'space-3', type: 'posted-in' },
    { id: 'e16', source: 'post-3', target: 'space-1', type: 'posted-in' },
    { id: 'e17', source: 'post-4', target: 'space-2', type: 'posted-in' },
    { id: 'e18', source: 'post-5', target: 'space-3', type: 'posted-in' },
    { id: 'e42', source: 'post-6', target: 'space-2', type: 'posted-in' },
    { id: 'e43', source: 'post-7', target: 'space-2', type: 'posted-in' },
    { id: 'e44', source: 'post-8', target: 'space-1', type: 'posted-in' },
    { id: 'e45', source: 'post-9', target: 'space-5', type: 'posted-in' },
    { id: 'e46', source: 'post-10', target: 'space-5', type: 'posted-in' },

    // User comments on posts
    { id: 'e19', source: 'user-1', target: 'post-1', type: 'commented-on' },
    { id: 'e20', source: 'user-2', target: 'post-1', type: 'commented-on' },
    { id: 'e21', source: 'user-3', target: 'post-3', type: 'commented-on' },
    { id: 'e22', source: 'user-4', target: 'post-4', type: 'commented-on' },
    { id: 'e23', source: 'user-5', target: 'post-2', type: 'commented-on' },
    { id: 'e24', source: 'user-1', target: 'post-5', type: 'commented-on' },
    { id: 'e47', source: 'user-6', target: 'post-1', type: 'commented-on' },
    { id: 'e48', source: 'user-6', target: 'post-8', type: 'commented-on' },
    { id: 'e49', source: 'user-7', target: 'post-6', type: 'commented-on' },
    { id: 'e50', source: 'user-8', target: 'post-4', type: 'commented-on' },
    { id: 'e51', source: 'user-8', target: 'post-7', type: 'commented-on' },
    { id: 'e52', source: 'user-9', target: 'post-9', type: 'commented-on' },
    { id: 'e53', source: 'user-10', target: 'post-10', type: 'commented-on' },
    { id: 'e54', source: 'user-10', target: 'post-2', type: 'commented-on' },
  ],
};
