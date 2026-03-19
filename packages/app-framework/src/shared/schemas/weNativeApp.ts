/**
 * WE Native App Template
 *
 * A native WE application with sidebar navigation and multiple views.
 * Built entirely from WE design system components - no embedded apps.
 */

import type { TemplateSchema } from '@we/schema-shared';

export const weNativeAppTemplateSchema: TemplateSchema = {
  meta: {
    name: 'WE Native App',
    description: 'Native WE application with sidebar navigation',
    icon: 'cube',
  },
  type: 'Row',
  props: { width: '100%', height: '100%' },
  children: [
    // Left sidebar
    {
      type: 'CollapsibleSidebar',
      props: {
        side: 'left',
        position: 'fixed',
        zIndex: 2,
        border: 'none',
        itemPadding: '12px',
        centerItems: true,
        // Navigation items
        items: [
          {
            type: 'item',
            id: 'dashboard',
            icon: 'house',
            label: 'Home',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
          },
          // {
          //   type: 'item',
          //   id: 'feed',
          //   icon: 'rss',
          //   label: 'Feed',
          //   onClick: { $action: 'routeStore.navigate', args: ['/feed'] },
          //   active: { $eq: [{ $store: 'routeStore.currentPath' }, '/feed'] },
          //   badge: 34,
          // },
          // Views group
          {
            type: 'group',
            id: 'views',
            label: 'Explore',
            collapsible: true,
            items: [
              {
                type: 'item',
                id: 'globe',
                // icon: 'globe',
                // icon: 'globe-hemisphere-east',
                icon: 'globe-hemisphere-west',
                // icon: 'globe-stand',
                label: 'Globe',
                onClick: { $action: 'routeStore.navigate', args: ['/globe'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/globe'] },
              },
              {
                type: 'item',
                id: 'graph',
                icon: 'graph',
                label: 'Graph',
                onClick: { $action: 'routeStore.navigate', args: ['/graph'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/graph'] },
              },
              {
                type: 'item',
                id: 'list',
                // icon: 'list-bullets',
                // icon: 'squares-four',
                // icon: 'grid-nine',
                // icon: 'cards',
                icon: 'cards-three',
                label: 'Cards',
                onClick: { $action: 'routeStore.navigate', args: ['/list'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/list'] },
                // badge: 34,
              },
              // {
              //   type: 'item',
              //   id: 'calendar',
              //   icon: 'calendar',
              //   label: 'Calendar',
              //   onClick: { $action: 'routeStore.navigate', args: ['/calendar'] },
              //   active: { $eq: [{ $store: 'routeStore.currentPath' }, '/calendar'] },
              //   // badge: 10,
              // },
            ],
          },
          // {
          //   type: 'item',
          //   id: 'tasks',
          //   icon: 'list-checks',
          //   label: 'Tasks',
          //   onClick: { $action: 'routeStore.navigate', args: ['/tasks'] },
          //   active: { $eq: [{ $store: 'routeStore.currentPath' }, '/tasks'] },
          // },
          // Actions group
          {
            type: 'group',
            id: 'actions',
            label: 'Create',
            collapsible: true,
            items: [
              {
                type: 'item',
                id: 'new-post',
                icon: 'cube',
                // icon: 'square',
                // icon: 'atom',
                label: 'New post',
                onClick: { $action: 'routeStore.navigate', args: ['/new-post'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/new-post'] },
              },
              {
                type: 'item',
                id: 'new-space',
                // icon: 'dna',
                // icon: 'circles-three',
                // icon: 'plus-circle',
                // icon: 'circles-three-plus',
                // icon: 'circle-dashed',
                // icon: 'circle',
                // icon: 'seal',
                icon: 'map-pin-area',
                label: 'New space',
                onClick: { $action: 'routeStore.navigate', args: ['/new-space'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/new-space'] },
              },
            ],
          },
          // Spaces group — items populated dynamically from adamStore.mySpaceSidebarItems
          {
            type: 'group',
            id: 'spaces',
            label: 'Spaces',
            collapsible: true,
            collapsed: false,
            items: { $store: 'adamStore.mySpaceSidebarItems' },
          },
          // // Quest group
          // {
          //   type: 'group',
          //   id: 'tools',
          //   label: 'Quests',
          //   collapsible: true,
          //   items: [
          //     {
          //       type: 'item',
          //       id: 'dev-team',
          //       avatar: { src: 'https://i.pravatar.cc/150?img=2', name: 'Dev Team' },
          //       label: 'Quest 1',
          //       onClick: { $action: 'routeStore.navigate', args: ['/spaces/dev'] },
          //       active: { $eq: [{ $store: 'routeStore.currentPath' }, '/spaces/dev'] },
          //     },
          //   ],
          // },
        ],

        // Footer items
        footerItems: [
          {
            type: 'item',
            id: 'logout',
            icon: 'list',
            label: 'Logout',
            onClick: { $action: 'authStore.logout' },
          },
        ],
      },
      slots: {
        header: {
          type: 'Column',
          props: {
            width: '66px',
            height: '66px',
            ax: 'center',
            ay: 'center',
          },
          children: [
            {
              type: 'we-image',
              props: {
                src: '/we-text.svg',
                alt: 'WE Logo',
                width: '38px',
                height: '38px',
                gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              },
            },
          ],
        },
      },
    },
    // Main panel
    {
      type: 'Column',
      props: { zIndex: 1, width: '100%', height: '100%', bg: 'ui-50', px: '66px' },
      children: [{ type: '$routes' }],
    },
    // Right sidebar
    {
      type: 'CollapsibleSidebar',
      props: {
        side: 'right',
        position: 'fixed',
        zIndex: 2,
        border: 'none',
        itemPadding: '12px',
        centerItems: true,
        // Navigation items
        items: [
          {
            type: 'item',
            id: 'profile',
            icon: 'user',
            label: 'Profile',
            onClick: { $action: 'routeStore.navigate', args: ['/profile'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/profile'] },
          },
          {
            type: 'item',
            id: 'notifications',
            icon: 'bell',
            label: 'Notifications',
            onClick: { $action: 'routeStore.navigate', args: ['/notifications'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/notifications'] },
            badge: 5,
          },
          {
            type: 'item',
            id: 'messages',
            icon: 'envelope-simple',
            label: 'Messages',
            onClick: { $action: 'routeStore.navigate', args: ['/messages'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/messages'] },
            // badge: 15,
          },
          {
            type: 'item',
            id: 'wallet',
            icon: 'wallet',
            label: 'Wallet',
            onClick: { $action: 'routeStore.navigate', args: ['/wallet'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/wallet'] },
            badge: '$520',
          },
          // {
          //   type: 'item',
          //   id: 'call',
          //   icon: 'phone',
          //   label: 'Call',
          //   onClick: { $action: 'routeStore.navigate', args: ['/call'] },
          //   active: { $eq: [{ $store: 'routeStore.currentPath' }, '/call'] },
          // },
          // Spaces group
          {
            type: 'group',
            id: 'friends',
            label: 'Friends',
            collapsible: true,
            collapsed: false,
            items: [
              {
                type: 'item',
                id: 'sarah',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=5',
                  name: 'Sarah Chen',
                  status: 'online',
                },
                label: 'Sarah Chen',
                // badge: 2,
                onClick: { $action: 'routeStore.navigate', args: ['/friends/sarah'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/sarah'] },
              },
              {
                type: 'item',
                id: 'marcus',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=12',
                  name: 'Marcus Rodriguez',
                  status: 'online',
                },
                label: 'Marcus Rodriguez',
                onClick: { $action: 'routeStore.navigate', args: ['/friends/marcus'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/marcus'] },
              },
              {
                type: 'item',
                id: 'elena',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=9',
                  name: 'Elena Popov',
                  status: 'away',
                },
                label: 'Elena Popov',
                badge: 1,
                onClick: { $action: 'routeStore.navigate', args: ['/friends/elena'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/elena'] },
              },
              {
                type: 'item',
                id: 'james',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=3',
                  name: 'James Wilson',
                  status: 'offline',
                },
                label: 'James Wilson',
                onClick: { $action: 'routeStore.navigate', args: ['/friends/james'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/james'] },
              },
              {
                type: 'item',
                id: 'priya',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=16',
                  name: 'Priya Sharma',
                  status: 'online',
                },
                label: 'Priya Sharma',
                onClick: { $action: 'routeStore.navigate', args: ['/friends/priya'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/priya'] },
              },
              {
                type: 'item',
                id: 'alex',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=7',
                  name: 'Alex Kim',
                  status: 'online',
                },
                label: 'Alex Kim',
                badge: 5,
                onClick: { $action: 'routeStore.navigate', args: ['/friends/alex'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/alex'] },
              },
              {
                type: 'item',
                id: 'sophie',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=10',
                  name: 'Sophie Martin',
                  status: 'away',
                },
                label: 'Sophie Martin',
                onClick: { $action: 'routeStore.navigate', args: ['/friends/sophie'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/friends/sophie'] },
              },
            ],
          },
        ],

        // Footer items
        footerItems: [
          {
            type: 'item',
            id: 'logout',
            icon: 'list',
            label: 'Logout',
            onClick: { $action: 'authStore.logout' },
          },
        ],
      },
    },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { width: '100%', height: '100%', bg: 'ui-50', overflow: 'auto' },
      children: [
        // Welcome header
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '0.5rem',
            bg: 'ui-0',
            borderBottom: '1px solid',
            borderColor: 'ui-200',
          },
          children: [
            {
              type: 'we-text',
              props: { text: 'Welcome back, James', size: '800', weight: '600', color: 'ui-900' },
            },
            {
              type: 'we-text',
              props: { text: "Here's what's happening today", size: '400', color: 'ui-600' },
            },
          ],
        },

        // Main content
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '2rem',
          },
          children: [
            // Stats cards row
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '1rem',
                wrap: true,
              },
              children: [
                // Active Spaces card
                {
                  type: 'Column',
                  props: {
                    flex: '1',
                    minWidth: '200px',
                    p: '1.5rem',
                    gap: '0.5rem',
                    bg: 'ui-0',
                    r: 'md',
                    borderLeft: '4px solid',
                    borderColor: 'primary-500',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        text: 'Active Spaces',
                        size: '300',
                        weight: '600',
                        color: 'ui-600',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '12',
                        size: '900',
                        weight: '700',
                        color: 'ui-900',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '+2 this week',
                        size: '200',
                        color: 'primary-600',
                      },
                    },
                  ],
                },
                // Unread Messages card
                {
                  type: 'Column',
                  props: {
                    flex: '1',
                    minWidth: '200px',
                    p: '1.5rem',
                    gap: '0.5rem',
                    bg: 'ui-0',
                    r: 'md',
                    borderLeft: '4px solid',
                    borderColor: 'blue-500',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        text: 'Unread Messages',
                        size: '300',
                        weight: '600',
                        color: 'ui-600',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '24',
                        size: '900',
                        weight: '700',
                        color: 'ui-900',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: 'Across 5 spaces',
                        size: '200',
                        color: 'ui-600',
                      },
                    },
                  ],
                },
                // Active Quests card
                {
                  type: 'Column',
                  props: {
                    flex: '1',
                    minWidth: '200px',
                    p: '1.5rem',
                    gap: '0.5rem',
                    bg: 'ui-0',
                    r: 'md',
                    borderLeft: '4px solid',
                    borderColor: 'green-500',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        text: 'Active Quests',
                        size: '300',
                        weight: '600',
                        color: 'ui-600',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '7',
                        size: '900',
                        weight: '700',
                        color: 'ui-900',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '3 due this week',
                        size: '200',
                        color: 'green-600',
                      },
                    },
                  ],
                },
                // Notifications card
                {
                  type: 'Column',
                  props: {
                    flex: '1',
                    minWidth: '200px',
                    p: '1.5rem',
                    gap: '0.5rem',
                    bg: 'ui-0',
                    r: 'md',
                    borderLeft: '4px solid',
                    borderColor: 'orange-500',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        text: 'Notifications',
                        size: '300',
                        weight: '600',
                        color: 'ui-600',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: '18',
                        size: '900',
                        weight: '700',
                        color: 'ui-900',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        text: 'New today',
                        size: '200',
                        color: 'ui-600',
                      },
                    },
                  ],
                },
              ],
            },

            // Two column layout
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '1.5rem',
                ax: 'start',
              },
              children: [
                // Left column - Recent Activity
                {
                  type: 'Column',
                  props: {
                    flex: '2',
                    gap: '1rem',
                  },
                  children: [
                    // Section header
                    {
                      type: 'we-text',
                      props: {
                        text: 'Recent Activity',
                        size: '600',
                        weight: '600',
                        color: 'ui-900',
                      },
                    },
                    // Activity cards
                    {
                      type: 'Column',
                      props: {
                        gap: '0.75rem',
                      },
                      children: [
                        // Activity 1
                        {
                          type: 'Row',
                          props: {
                            p: '1rem',
                            gap: '1rem',
                            bg: 'ui-0',
                            r: 'md',
                            ay: 'center',
                          },
                          children: [
                            {
                              type: 'we-avatar',
                              props: {
                                image: 'https://i.pravatar.cc/150?img=5',
                                size: 'md',
                              },
                            },
                            {
                              type: 'Column',
                              props: {
                                flex: '1',
                                gap: '0.25rem',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Sarah Chen commented on your post',
                                    size: '400',
                                    weight: '500',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: '2 minutes ago',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        // Activity 2
                        {
                          type: 'Row',
                          props: {
                            p: '1rem',
                            gap: '1rem',
                            bg: 'ui-0',
                            r: 'md',
                            ay: 'center',
                          },
                          children: [
                            {
                              type: 'we-avatar',
                              props: {
                                image: 'https://i.pravatar.cc/150?img=12',
                                size: 'md',
                              },
                            },
                            {
                              type: 'Column',
                              props: {
                                flex: '1',
                                gap: '0.25rem',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Marcus Rodriguez invited you to Design Team',
                                    size: '400',
                                    weight: '500',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: '1 hour ago',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        // Activity 3
                        {
                          type: 'Row',
                          props: {
                            p: '1rem',
                            gap: '1rem',
                            bg: 'ui-0',
                            r: 'md',
                            ay: 'center',
                          },
                          children: [
                            {
                              type: 'we-avatar',
                              props: {
                                image: 'https://i.pravatar.cc/150?img=9',
                                size: 'md',
                              },
                            },
                            {
                              type: 'Column',
                              props: {
                                flex: '1',
                                gap: '0.25rem',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Elena Popov shared a new file in Dev Team',
                                    size: '400',
                                    weight: '500',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: '3 hours ago',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        // Activity 4
                        {
                          type: 'Row',
                          props: {
                            p: '1rem',
                            gap: '1rem',
                            bg: 'ui-0',
                            r: 'md',
                            ay: 'center',
                          },
                          children: [
                            {
                              type: 'we-avatar',
                              props: {
                                initials: 'WE',
                                size: 'md',
                              },
                            },
                            {
                              type: 'Column',
                              props: {
                                flex: '1',
                                gap: '0.25rem',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Quest "Launch MVP" was completed',
                                    size: '400',
                                    weight: '500',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Yesterday',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },

                // Right column - Quick Actions & Upcoming
                {
                  type: 'Column',
                  props: {
                    flex: '1',
                    gap: '1.5rem',
                  },
                  children: [
                    // Quick Actions
                    {
                      type: 'Column',
                      props: {
                        gap: '1rem',
                      },
                      children: [
                        {
                          type: 'we-text',
                          props: {
                            text: 'Quick Actions',
                            size: '600',
                            weight: '600',
                            color: 'ui-900',
                          },
                        },
                        {
                          type: 'Column',
                          props: {
                            gap: '0.5rem',
                          },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                text: 'Create New Post',
                                variant: 'primary',
                                width: '100%',
                              },
                            },
                            {
                              type: 'we-button',
                              props: {
                                text: 'Start New Quest',
                                variant: 'ghost',
                                width: '100%',
                              },
                            },
                            {
                              type: 'we-button',
                              props: {
                                text: 'Invite Members',
                                variant: 'ghost',
                                width: '100%',
                              },
                            },
                          ],
                        },
                      ],
                    },

                    // Upcoming Events
                    {
                      type: 'Column',
                      props: {
                        gap: '1rem',
                      },
                      children: [
                        {
                          type: 'we-text',
                          props: {
                            text: 'Upcoming',
                            size: '600',
                            weight: '600',
                            color: 'ui-900',
                          },
                        },
                        {
                          type: 'Column',
                          props: {
                            gap: '0.75rem',
                          },
                          children: [
                            // Event 1
                            {
                              type: 'Column',
                              props: {
                                p: '1rem',
                                gap: '0.5rem',
                                bg: 'ui-0',
                                r: 'md',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Team Standup',
                                    size: '400',
                                    weight: '600',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Today at 10:00 AM',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                            // Event 2
                            {
                              type: 'Column',
                              props: {
                                p: '1rem',
                                gap: '0.5rem',
                                bg: 'ui-0',
                                r: 'md',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Design Review',
                                    size: '400',
                                    weight: '600',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Tomorrow at 2:00 PM',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                            // Event 3
                            {
                              type: 'Column',
                              props: {
                                p: '1rem',
                                gap: '0.5rem',
                                bg: 'ui-0',
                                r: 'md',
                              },
                              children: [
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Sprint Planning',
                                    size: '400',
                                    weight: '600',
                                    color: 'ui-900',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    text: 'Friday at 9:00 AM',
                                    size: '300',
                                    color: 'ui-600',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: '/list',
      type: 'Column',
      props: { width: '100%', height: '100%', bg: 'ui-50' },
      children: [
        // Header section with filters and search
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '1rem',
            bg: 'ui-0',
            borderBottom: '1px solid',
            borderColor: 'ui-200',
          },
          children: [
            // Title
            {
              type: 'we-text',
              props: {
                text: 'Feed',
                size: '800',
                weight: '600',
                color: 'ui-900',
              },
            },
            // Filters and Search Row
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '1rem',
                ay: 'center',
              },
              children: [
                // Filter buttons
                {
                  type: 'Row',
                  props: {
                    gap: '0.5rem',
                    ay: 'center',
                  },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        text: 'All',
                        variant: 'primary',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Following',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Trending',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Recent',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                  ],
                },
                // Search bar
                {
                  type: 'Row',
                  props: {
                    flex: '1',
                    maxWidth: '400px',
                    ml: 'auto',
                  },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        py: '200',
                        placeholder: 'Search posts...',
                        width: '100%',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        // Posts grid
        {
          type: 'Column',
          props: {
            width: '100%',
            height: '100%',
            p: '2rem',
            gap: '1.5rem',
            overflow: 'auto',
          },
          children: [
            // Posts container - using CSS Grid for responsive layout
            {
              type: 'Column',
              props: {
                styles: {
                  display: 'grid',
                  'grid-template-columns': 'repeat(auto-fill, minmax(350px, 1fr))',
                  gap: '1.5rem',
                  width: '100%',
                },
              },
              children: [
                // Post 1
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Sarah Chen',
                      avatar: 'https://i.pravatar.cc/150?img=5',
                    },
                    title: 'Building Scalable Design Systems',
                    text: 'Just published a comprehensive guide on creating design systems that scale with your team. Key lessons learned from working with 50+ designers.',
                  },
                },
                // Post 2
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Marcus Rodriguez',
                      avatar: 'https://i.pravatar.cc/150?img=12',
                    },
                    title: 'The Future of Web3 UX',
                    text: 'Exploring how decentralized applications can provide better user experiences. The gap between Web2 and Web3 UX is closing faster than we think.',
                  },
                },
                // Post 3
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Elena Popov',
                      avatar: 'https://i.pravatar.cc/150?img=9',
                    },
                    title: 'Animation Best Practices 2026',
                    text: 'Performance-first animations that delight users without sacrificing speed. Learn the techniques that top product teams are using.',
                  },
                },
                // Post 4
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'James Wilson',
                      avatar: 'https://i.pravatar.cc/150?img=3',
                    },
                    title: 'TypeScript 5.5 New Features',
                    text: 'Breaking down the latest TypeScript release and what it means for modern application development. Some game-changing improvements here.',
                  },
                },
                // Post 5
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Priya Sharma',
                      avatar: 'https://i.pravatar.cc/150?img=16',
                    },
                    title: 'Accessibility in 2026',
                    text: 'Why accessibility is not optional anymore. Real-world examples of inclusive design making products better for everyone.',
                  },
                },
                // Post 6
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Alex Kim',
                      avatar: 'https://i.pravatar.cc/150?img=7',
                    },
                    title: 'Reactive Programming Patterns',
                    text: 'Deep dive into reactive programming with SolidJS. How fine-grained reactivity changes the way we think about state management.',
                  },
                },
                // Post 7
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Sophie Martin',
                      avatar: 'https://i.pravatar.cc/150?img=10',
                    },
                    title: 'Design Tokens Revolution',
                    text: 'How design tokens are transforming the way teams collaborate between design and development. A standardized approach that works.',
                  },
                },
                // Post 8
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'David Liu',
                      avatar: 'https://i.pravatar.cc/150?img=13',
                    },
                    title: 'Building with Cesium',
                    text: 'Creating stunning 3D visualizations with Cesium. From basic globe rendering to complex spatial data visualization.',
                  },
                },
                // Post 9
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Maya Patel',
                      avatar: 'https://i.pravatar.cc/150?img=20',
                    },
                    title: 'Component Architecture Tips',
                    text: 'Lessons learned from building 100+ reusable components. How to strike the balance between flexibility and simplicity.',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: '/globe',
      type: 'Column',
      props: { width: '100%', height: '100%', position: 'relative' },
      children: [
        // Header section controls
        {
          type: 'Row',
          props: { width: '100%', p: '400', gap: '400', position: 'absolute', zIndex: 10 },
          children: [
            // Combined layer controls
            {
              type: 'PopoverToggleMenu',
              props: {
                placement: 'bottom-start',
                triggerLabel: 'Layers',
                triggerIcon: 'stack',
                items: [
                  {
                    type: 'group',
                    id: 'background',
                    label: 'Background',
                    collapsible: true,
                    items: [
                      {
                        id: 'skybox',
                        label: 'Skybox',
                        icon: 'image',
                        checked: { $store: 'spaceStore.showSkybox' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['skybox'] },
                      },
                      {
                        id: 'stars',
                        label: 'Procedural Stars',
                        icon: 'sparkle',
                        checked: { $store: 'spaceStore.showStars' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['stars'] },
                      },
                      {
                        id: 'solar-system',
                        label: 'Solar System',
                        icon: 'atom',
                        checked: { $store: 'spaceStore.showSolarSystem' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['solarSystem'] },
                      },
                    ],
                  },
                  {
                    type: 'group',
                    id: 'planet-surface',
                    label: 'Planet Surface',
                    collapsible: true,
                    items: [
                      {
                        id: 'user-locations',
                        label: 'User Locations',
                        icon: 'map-pin',
                        checked: { $store: 'spaceStore.showUserLocations' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['userLocations'] },
                      },
                      {
                        id: 'countries',
                        label: 'Country Outlines',
                        icon: 'flag',
                        checked: { $store: 'spaceStore.showCountryOutlines' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['countryOutlines'] },
                      },
                      {
                        id: 'h3',
                        label: 'H3 Hexagons',
                        icon: 'hexagon',
                        checked: { $store: 'spaceStore.showH3Hexagons' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['h3Hexagons'] },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        // Globe takes remaining space
        {
          type: 'CesiumGlobe',
          props: {
            width: '100%',
            height: 'calc(100vh - 200px)', // Full height minus header and padding
            backgroundLayers: [
              {
                factory: 'skyboxLayer',
                enabled: { $store: 'spaceStore.showSkybox' },
                options: {
                  textureSet: 'tycho2-4k',
                },
              },
              {
                factory: 'proceduralStarsLayer',
                enabled: { $store: 'spaceStore.showStars' },
                options: {
                  count: 2000,
                  minDistance: 10000,
                  maxDistance: 100000000,
                  minBrightness: 0.3,
                  maxBrightness: 1.0,
                  minSize: 1,
                  maxSize: 3,
                  color: '#ffffff',
                  show: true,
                },
              },
              {
                factory: 'solarSystemLayer',
                enabled: { $store: 'spaceStore.showSolarSystem' },
                options: {
                  planets: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
                  showSun: true,
                  showOrbits: true,
                  showPlanets: true,
                  showLabels: true,
                  planetScale: 1.5,
                  orbitScale: 0.01,
                  orbitWidth: 2,
                },
              },
            ],
            planetLayers: [
              {
                factory: 'userLocationsLayer',
                enabled: { $store: 'spaceStore.showUserLocations' },
                options: {
                  locations: { $store: 'spaceStore.space.userLocations' },
                  markerSize: 15,
                  defaultColor: '#00ffff',
                  onLocationClick: {
                    $action: 'consoleStore.log',
                    args: ['Location clicked:', '$arg'],
                  },
                },
              },
              {
                factory: 'countryOutlinesLayer',
                enabled: { $store: 'spaceStore.showCountryOutlines' },
                options: {
                  color: '#ffffff',
                  opacity: 0.5,
                  width: 2,
                },
              },
              {
                factory: 'h3HexagonsLayer',
                enabled: { $store: 'spaceStore.showH3Hexagons' },
                options: {
                  maxResolution: 8,
                  color: '#3388ff',
                  opacity: 0.6,
                  width: 2,
                  hoverColor: '#3388ff',
                  hoverOpacity: 0.3,
                  onHexagonClick: {
                    $action: 'consoleStore.log',
                    args: ['Hexagon clicked:', '$arg'],
                  },
                },
              },
            ],
          },
        },
      ],
    },
    {
      path: '/graph',
      type: 'Column',
      props: { width: '100%', height: '100%', position: 'relative' },
      children: [
        // Header section controls
        {
          type: 'Row',
          props: { width: '100%', p: '400', gap: '400', position: 'absolute', zIndex: 10 },
          children: [
            {
              type: 'we-text',
              props: { text: 'Network Graph', size: '600', weight: '600', color: 'ui-900' },
            },
          ],
        },
        // Graph takes remaining space
        {
          type: 'GraphWidget',
          props: {
            width: '100%',
            height: '100%',
            nodeStyle: { showLabel: true, labelColor: '#fff', labelBackgroundColor: '#372744', labelFontSize: 12 },
            interactions: {
              enableZoom: true,
              enablePan: false,
              onNodeClick: {
                $action: 'consoleStore.log',
                args: ['Node clicked:', '$arg'],
              },
            },
          },
        },
      ],
    },
    {
      path: '/new-post',
      type: 'Column',
      props: { ax: 'center', width: '100%', height: '100%', position: 'relative' },
      children: [
        {
          type: 'Column',
          props: { my: '400' },
          children: [{ type: 'we-text', props: { text: 'New post', size: '700', weight: '600', color: 'ui-700' } }],
        },
        { type: 'BlockComposer', props: {} },
      ],
    },
    {
      path: '/new-space',
      type: 'Column',
      props: { width: '100%', height: '100%' },
      children: [{ type: 'CreateSpacePage', props: {} }],
    },
    // {
    //   type: 'Column',
    //   props: {
    //     width: '100%',
    //     height: '100%',
    //     p: '2rem',
    //   },
    //   children: [
    //     {
    //       type: 'we-text',
    //       props: {
    //         text: 'Profile View',
    //         size: '2xl',
    //         weight: 'bold',
    //       },
    //     },
    //   ],
    // },
  ],
};
