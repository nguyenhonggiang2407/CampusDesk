export const statuses = ['new', 'triaged', 'in_progress', 'resolved', 'closed'] as const;
export const categories = ['facilities', 'it', 'student_affairs'] as const;
export const priorities = ['low', 'normal', 'high'] as const;
export type Status = typeof statuses[number];
export type Category = typeof categories[number];
export type Priority = typeof priorities[number];
export type Role = 'student' | 'staff';
export interface User { id: number; name: string; email: string; role: Role; }
export interface Session { user: User | null; csrfToken: string | null; }
export const statusLabels: Record<Status, string> = { new: 'New', triaged: 'Triaged', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
export const categoryLabels: Record<Category, string> = { facilities: 'Facilities', it: 'IT support', student_affairs: 'Student affairs' };
export const transitions: Record<Status, readonly Status[]> = { new: ['triaged', 'closed'], triaged: ['in_progress', 'closed'], in_progress: ['resolved', 'triaged'], resolved: ['closed', 'in_progress'], closed: ['triaged'] };
export interface Ticket {
  id: string; reference: string; title: string; description: string; category: Category;
  priority: Priority; status: Status; studentId: number; studentName: string;
  assignedTo: number | null; assignedName: string | null; dueDate: string;
  createdAt: string; updatedAt: string; version: number; commentCount: number;
}
export interface Comment { id: number; authorName: string; authorRole: Role; body: string; visibility: 'public' | 'private'; createdAt: string; }
export interface TicketEvent { id: number; actorName: string; message: string; createdAt: string; }
export interface TicketDetail extends Ticket { comments: Comment[]; events: TicketEvent[]; }
export interface TicketPage { tickets: Ticket[]; total: number; page: number; pages: number; }
export interface Summary { total: number; open: number; overdue: number; resolved: number; unassigned: number; highPriority: number; }
export interface StaffMember { id: number; name: string; }
