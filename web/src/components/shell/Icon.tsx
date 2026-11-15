import {
  Archive, ArrowLeft, BarChart3, Bell, ChevronUp, ChevronsUpDown, Download, IndianRupee, MapPin, Pencil, Plus, Trash2, UserPlus, Building2, Calculator, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Contact, EllipsisVertical, FileSignature,
  ArrowDownRight, ArrowLeftRight, ArrowUpRight, LogOut, PanelLeftClose, PanelLeftOpen, FileText, Folder, Home, Info, LayoutGrid, Lock, Moon, Package, Receipt, RotateCcw, Search, Settings2, Sun, TriangleAlert, Truck, Users, WifiOff, X,
  Banknote, Camera, Copy, ExternalLink, Eye, Filter, History, Image, Landmark, Link2, List, ListTree, Mail, MessageCircle, Minus, Paperclip, Percent, Phone, PieChart, Printer, RefreshCw, Repeat, Save, Send, Share2, Shield, Table, Tag, Upload, Wallet,
  type LucideIcon,
} from "lucide-react";

// Lucide line icons, monochrome (spec §4A.2). Every icon sits beside a text label (design-tokens §3).
const MAP: Record<string, LucideIcon> = {
  home: Home, folder: Folder, users: Users, receipt: Receipt, package: Package, contact: Contact, "file-text": FileText,
  "file-signature": FileSignature, calculator: Calculator, calendar: Calendar, truck: Truck, building: Building2, "bar-chart": BarChart3,
  settings: Settings2, grid: LayoutGrid, bell: Bell, search: Search, sun: Sun, moon: Moon, check: Check, "check-circle": CheckCircle2,
  clock: Clock, alert: TriangleAlert, x: X, "chevron-right": ChevronRight, "chevron-down": ChevronDown, info: Info, "wifi-off": WifiOff,
  "more-v": EllipsisVertical, lock: Lock, reset: RotateCcw, download: Download, "chevron-up": ChevronUp,
  "chevrons-up-down": ChevronsUpDown, plus: Plus, edit: Pencil, trash: Trash2, archive: Archive, back: ArrowLeft, pin: MapPin, rupee: IndianRupee,
  refresh: RefreshCw, camera: Camera, upload: Upload, image: Image, paperclip: Paperclip, eye: Eye, share: Share2, printer: Printer, filter: Filter, copy: Copy,
  link: Link2, phone: Phone, mail: Mail, wallet: Wallet, bank: Landmark, cash: Banknote, send: Send, list: List, tree: ListTree, tag: Tag, percent: Percent,
  external: ExternalLink, history: History, shield: Shield, repeat: Repeat, minus: Minus, save: Save, message: MessageCircle, "pie-chart": PieChart, table: Table,
  "user-plus": UserPlus, "panel-close": PanelLeftClose, "panel-open": PanelLeftOpen, logout: LogOut, switch: ArrowLeftRight, "trend-up": ArrowUpRight, "trend-down": ArrowDownRight,
};

export function Icon({ name, size = 20, className = "icon" }: { name: string; size?: number; className?: string }) {
  const C = MAP[name] ?? Info;
  return <C className={className} width={size} height={size} strokeWidth={1.75} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />;
}
