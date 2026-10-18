import { ApiProperty } from '@nestjs/swagger';

export enum NotificationType {
  INFO = 'INFO',
  WARNING = 'WARNING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export enum NotificationCategory {
  ORDER = 'ORDER',
  PAYMENT = 'PAYMENT',
  SYSTEM = 'SYSTEM',
  PROMOTION = 'PROMOTION',
  ACTIVITY = 'ACTIVITY',
  STUDY = 'STUDY',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export class Notification {
  @ApiProperty({
    type: Number,
  })
  id: number;

  @ApiProperty({
    type: Number,
    description: 'User ID who receives this notification',
  })
  userId: number;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.INFO,
  })
  type: NotificationType;

  @ApiProperty({
    enum: NotificationCategory,
    example: NotificationCategory.SYSTEM,
  })
  category: NotificationCategory;

  @ApiProperty({
    example: 'Your order has been shipped',
    type: String,
  })
  title: string;

  @ApiProperty({
    example: 'Your order #12345 has been shipped and will arrive in 2-3 days.',
    type: String,
  })
  content: string;

  @ApiProperty({
    type: Object,
    required: false,
    description: 'Additional metadata in JSON format',
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({
    enum: NotificationChannel,
    isArray: true,
    example: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  })
  channels: NotificationChannel[];

  @ApiProperty({
    type: Object,
    description: 'Tracking of sent channels with status',
  })
  sentChannels: Record<string, { sent: boolean; sentAt?: Date; error?: string }>;

  @ApiProperty({
    example: false,
    type: Boolean,
  })
  isRead: boolean;

  @ApiProperty({
    required: false,
  })
  readAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  deletedAt?: Date;
}
