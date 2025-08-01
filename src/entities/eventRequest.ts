import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { EventParticipant } from "./eventParticipant";
import { PaymentStatus } from "../constants/enums";
import { User } from "./user";

@Entity("event_requests")
export class EventRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  slug!: string;

  @Column({ type: "varchar", length: 255 })
  imageUrl!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 255 })
  eventType!: string;

  @Column({ type: "varchar", length: 255 })
  clientName!: string;

  @Column({ type: "varchar", length: 20 })
  phoneNumber!: string;

  @Column({ type: "date" })
  pickupDate!: string;

  @Column({ type: "varchar", length: 500 })
  location!: string;

  @Column({ type: "varchar", length: 255 })
  vehicle!: string;

  @Column({ type: "int" })
  hoursReserved!: number;

  @Column({ type: "int" })
  passengerCount!: number;

  @Column({ type: "int" })
  totalAmount?: number;

  @Column({ type: "int" })
  pendingAmount?: number;

  @Column({ type: "int" })
  depositAmount?: number;

  @Column({ type: "int" })
  equityDivision?: number;

  @Column({ type: "enum", enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @ManyToOne(() => User, (user) => user.eventRequests)
  @JoinColumn({ name: "userId" })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  host?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  cohosts?: string[];

  @Column({ type: "varchar", length: 255, nullable: true })
  participants?: string[];
}
