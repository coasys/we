export interface AvatarInfo {
  image?: string;
  hash?: string;
  initials?: string;
  icon?: string;
}

export interface AvatarStackProps {
  avatars: AvatarInfo[];
  max?: number;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  overlap?: number;
  ring?: string;
  styles?: Record<string, string | number>;
}
