import { CATEGORY_ICONS, categoryIconName, type CategoryIconName } from '@stow/core';
import {
  Archive,
  Bookmark,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Car,
  Code,
  Coffee,
  Dumbbell,
  FileText,
  Film,
  Flag,
  Folder,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image as ImageIcon,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  MessageCircle,
  Music,
  Newspaper,
  Palette,
  PenTool,
  Plane,
  Rocket,
  ShoppingCart,
  Star,
  Tag,
  Terminal,
  Users,
  Utensils,
  Video,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryIconOption {
  name: CategoryIconName;
  label: string;
  Icon: LucideIcon;
}

const ICONS: Record<CategoryIconName, Omit<CategoryIconOption, 'name'>> = {
  folder: { label: 'Folder', Icon: Folder },
  briefcase: { label: 'Briefcase', Icon: Briefcase },
  house: { label: 'House', Icon: House },
  'book-open': { label: 'Book', Icon: BookOpen },
  'graduation-cap': { label: 'Graduation cap', Icon: GraduationCap },
  code: { label: 'Code', Icon: Code },
  terminal: { label: 'Terminal', Icon: Terminal },
  newspaper: { label: 'Newspaper', Icon: Newspaper },
  video: { label: 'Video', Icon: Video },
  film: { label: 'Film', Icon: Film },
  music: { label: 'Music', Icon: Music },
  image: { label: 'Image', Icon: ImageIcon },
  camera: { label: 'Camera', Icon: Camera },
  'gamepad-2': { label: 'Gamepad', Icon: Gamepad2 },
  'shopping-cart': { label: 'Shopping cart', Icon: ShoppingCart },
  wallet: { label: 'Wallet', Icon: Wallet },
  plane: { label: 'Plane', Icon: Plane },
  'map-pin': { label: 'Map pin', Icon: MapPin },
  car: { label: 'Car', Icon: Car },
  utensils: { label: 'Utensils', Icon: Utensils },
  coffee: { label: 'Coffee', Icon: Coffee },
  heart: { label: 'Heart', Icon: Heart },
  star: { label: 'Star', Icon: Star },
  bookmark: { label: 'Bookmark', Icon: Bookmark },
  lightbulb: { label: 'Lightbulb', Icon: Lightbulb },
  wrench: { label: 'Wrench', Icon: Wrench },
  palette: { label: 'Palette', Icon: Palette },
  'pen-tool': { label: 'Pen', Icon: PenTool },
  globe: { label: 'Globe', Icon: Globe },
  users: { label: 'People', Icon: Users },
  'message-circle': { label: 'Chat', Icon: MessageCircle },
  mail: { label: 'Mail', Icon: Mail },
  calendar: { label: 'Calendar', Icon: Calendar },
  'file-text': { label: 'Document', Icon: FileText },
  archive: { label: 'Archive', Icon: Archive },
  tag: { label: 'Tag', Icon: Tag },
  flag: { label: 'Flag', Icon: Flag },
  rocket: { label: 'Rocket', Icon: Rocket },
  dumbbell: { label: 'Dumbbell', Icon: Dumbbell },
  leaf: { label: 'Leaf', Icon: Leaf },
};

/** CATEGORY_ICONS in order, with each name's lucide component and an accessible label. */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = CATEGORY_ICONS.map((name) => ({ name, ...ICONS[name] }));

export interface CategoryIconProps {
  icon: unknown;
  color: string;
  className?: string;
}

/** The category's icon drawn in its colour. Decorative (aria-hidden); always pair it with the category name. */
export function CategoryIcon({ icon, color, className = 'size-4' }: CategoryIconProps) {
  const { Icon } = ICONS[categoryIconName(icon)];
  return <Icon aria-hidden="true" className={`shrink-0 ${className}`} style={{ color }} />;
}
