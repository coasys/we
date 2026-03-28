export interface PostCardProps {
  creator?: { name: string; avatar: string };
  title: string;
  text: string;
  class?: string;
  styles?: Record<string, string | number>;
}
