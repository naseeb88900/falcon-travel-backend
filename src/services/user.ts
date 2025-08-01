import { AppDataSource } from "../config/db";
import { User } from "../entities/user";
import { Event } from "../entities/event";
import bcrypt, { genSalt } from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { EventParticipant } from "../entities/eventParticipant";
import {
  EventStatus,
  EventType,
  MemberRole,
  notificationType,
  PaymentStatus,
} from "../constants/enums";
import { RequestEventDts } from "../types/event";
import { AuthenticatedRequest, JwtPayload } from "../types/request";
import { InviteToken } from "../entities/inviteToken";
import { MoreThan } from "typeorm";
import { EventRequest } from "../entities/eventRequest";
import { generateSlug } from "../utils/slugify";
import { EventMedia } from "../entities/eventMedia";
import { mediaHandler } from "../utils/mediaHandler";
import { Request } from "express";
import { EventFeedback } from "../entities/eventFeedback";
import { getIO } from "../config/socket";
import { Notification } from "../entities/notifications";
import notificationService from "./notification";
import { NotificationInputDts } from "../types/notification";
import eventService from "./event";
import { EventMessage } from "../entities/eventMessage";

const UserRepository = AppDataSource.getRepository(User);
const EventRepository = AppDataSource.getRepository(Event);
const InviteRepository = AppDataSource.getRepository(InviteToken);
const FeedbackRepository = AppDataSource.getRepository(EventFeedback);
const RequestRepository = AppDataSource.getRepository(EventRequest);
const MediaRepository = AppDataSource.getRepository(EventMedia);
const MessageRepository = AppDataSource.getRepository(EventMessage);
const NotificationRepository = AppDataSource.getRepository(Notification);

const EventParticipantRepository =
  AppDataSource.getRepository(EventParticipant);

const userService = {
  registerUser: async (
    email: string,
    password: string,
    inviteToken: string
  ) => {
    return await userService.handleUserRegistration(
      email,
      password,
      inviteToken
    );
  },

  registerWithGoogle: async (email: string, inviteToken: string) => {
    return await userService.handleUserRegistration(email, null, inviteToken);
  },

  registerWithApple: async (
    email: string,
    sub: string,
    inviteToken: string
  ) => {
    let user = await UserRepository.findOne({ where: { appleSubId: sub } });

    if (!user) {
      user = UserRepository.create({
        appleSubId: sub,
        email: email,
        fullName: "Apple User",
      });
      await UserRepository.save(user);
    }

    return await userService.handleUserRegistration(email, null, inviteToken);
  },

  addUserDetails: async (
    fullName: string,
    dob: string,
    phone: string,
    email: string
  ) => {
    const userExists = await userService.findUserWithEmail(email);

    userExists.fullName = fullName;
    userExists.dateOfBirth = dob;
    userExists.phoneNumber = phone;

    await UserRepository.save(userExists);

    return { message: "success", data: {} };
  },

  loginUser: async (email: string, password: string, token?: string) => {
    const user = await userService.findUserWithEmail(email);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error("Incorrect Password");

    if (token) {
      await userService.joinEvent(token, email);
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET_KEY!, {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    } as SignOptions);
    return { message: "success", data: jwtToken };
  },

  loginWithOAuth: async (user: User, token?: string) => {
    const payload = { id: user.id, email: user.email, role: user.role };
    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET_KEY!, {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    } as SignOptions);

    if (token) {
      await userService.joinEvent(token, user.email);
    }

    return { message: "success", data: jwtToken };
  },

  requestEvent: async (
    event: RequestEventDts,
    email: string,
    req: AuthenticatedRequest
  ) => {
    const slug = generateSlug(event.eventDetails.clientName);

    const user = await userService.findUserWithEmail(email);

    const imageURL = await mediaHandler(req, email, slug, {
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
    });

    const newRequest = RequestRepository.create({
      imageUrl: imageURL[0],
      name: event.eventDetails.name,
      eventType: event.eventDetails.eventType,
      clientName: event.eventDetails.clientName,
      phoneNumber: event.eventDetails.phoneNumber,
      pickupDate: event.eventDetails.pickupDate,
      location: event.eventDetails.location,
      vehicle: event.vehicleInfo.vehicleName,
      passengerCount: event.vehicleInfo.numberOfPassengers,
      hoursReserved: event.vehicleInfo.hoursReserved,
      host: email,
      cohosts: event.cohosts,
      participants: [email, ...event.cohosts],
      user: user,
      slug: slug,
    });

    await RequestRepository.save(newRequest);

    const notification = {
      message: `${newRequest.clientName} has requested an event (${newRequest.slug}) for approval.`,
      title: "New Event Request",
      emit_event: notificationType.EVENT_REQUEST,
      metadata: {
        slug: newRequest.slug,
        id: newRequest.id,
        createdAt: newRequest.createdAt,
        createdBy: newRequest.user.email,
      },
      eventType: EventType.REQUEST,
      request: newRequest,
    } as NotificationInputDts;

    const admin = await userService.getAdmin();

    await notificationService.send(notification, [admin]);

    return { message: "success", data: newRequest };
  },

  handleUserRegistration: async (
    email: string,
    password: string | null,
    inviteToken: string
  ) => {
    if (!inviteToken) throw new Error("Invalid Invite Token");

    const userExists = await UserRepository.findOne({
      where: { email: email },
    });

    if (userExists) throw new Error("User already exists!");

    const { inviteFound, event } = await userService.checkInvite(inviteToken);

    let hashedPassword = "";
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    const user = UserRepository.create({
      email,
      password: hashedPassword,
    });

    await UserRepository.save(user);

    await userService.addEventParticipant(event, email, inviteFound);

    const payload = { id: user.id, email: user.email, role: user.role };

    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET_KEY!, {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    } as SignOptions);

    return { message: "success", data: jwtToken };
  },

  resetPassword: async (newPassword: string, user: JwtPayload) => {
    const userFound = await userService.findUserWithEmail(user.email);

    const salt = await genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    userFound.password = hashedPassword;

    await UserRepository.save(userFound);

    return { message: "success", data: {} };
  },

  findOAuthUser: async (provider: "google" | "apple", identifier: string) => {
    let user: User | null;

    if (provider === "google") {
      user = await UserRepository.findOne({
        where: { email: identifier },
      });
      if (!user) throw new Error("No Google account registered");
    } else if (provider === "apple") {
      user = await UserRepository.findOne({
        where: { appleSubId: identifier },
      });
      if (!user) throw new Error("No Apple account registered");
    }

    return user!;
  },

  uploadMedia: async (email: string, eventSlug: string, req: Request) => {
    const user = await userService.findUserWithEmail(email);
    const event = await eventService.getEventBySlug(eventSlug);

    if (event.eventStatus !== EventStatus.FINISHED) {
      throw new Error("Cannot Add Media to this event yet!");
    }

    const uploadedUrls = await mediaHandler(req, user.email, event.slug);

    const mediaEntries = uploadedUrls.map((url) =>
      MediaRepository.create({ url, user, event })
    );

    await MediaRepository.save(mediaEntries);

    return { message: "success", data: uploadedUrls };
  },

  submitFeedback: async (
    event: string,
    ratings: { Q1: number; Q2: number; Q3: number; Q4: number; Q5: number },
    feedback: { avg: number; description: string },
    email: string
  ) => {
    const eventFound = await EventRepository.findOne({
      where: { slug: event },
    });

    if (!eventFound) throw new Error("Event does not exist!");

    if (eventFound.eventStatus !== EventStatus.FINISHED) {
      throw new Error("Cannot Add Feedback to this event yet!");
    }

    const user = await userService.findUserWithEmail(email);

    const newFeedback = FeedbackRepository.create({
      event: eventFound,
      user: user,
      Q1: ratings.Q1,
      Q2: ratings.Q2,
      Q3: ratings.Q3,
      Q4: ratings.Q4,
      Q5: ratings.Q5,
      averageRating: feedback.avg,
      description: feedback.description,
    });

    await FeedbackRepository.save(newFeedback);

    // const message = `${user.fullName} has submitted a feedback to the event (${eventFound.slug}).`;

    // getIO().to(`event_${eventFound.slug}`).emit("new_feedback", {
    //   message: message,
    //   id: newFeedback.id,
    //   createdAt: newFeedback.createdAt,
    // });

    // const newNotification = NotificationRepository.create({
    //   title: "New Feedback",
    //   description: message,
    //   type: EventType.FEEDBACK,
    //   read: false,
    //   user: user,
    //   triggeredBy: user,
    //   event: eventFound,
    // });

    // await NotificationRepository.save(newNotification);

    return { message: "success", data: newFeedback };
  },

  addMusic: async () => {}, // In Progress

  addPersonalMessage: async (
    email: string,
    eventSlug: string,
    message: string
  ) => {
    const user = await userService.findUserWithEmail(email);
    const event = await eventService.getEventBySlug(eventSlug);

    const newMessage = MessageRepository.create({
      message: message,
      user: user,
      event: event,
    });

    await MessageRepository.save(newMessage);
  },

  findUserWithEmail: async (email: string) => {
    const user = await UserRepository.findOne({ where: { email: email } });

    if (!user) throw new Error("User not found!");

    return user;
  },

  findUserWithId: async (userId: string) => {
    const user = await UserRepository.findOne({ where: { id: userId } });

    if (!user) throw new Error("User not found!");

    return user;
  },

  addEventParticipant: async (
    event: Event,
    email: string,
    inviteFound: InviteToken
  ) => {
    const existing = await EventParticipantRepository.findOne({
      where: { email: email, event: { slug: inviteFound.eventSlug } },
    });

    const isHost = email === event.host;
    let role: MemberRole = isHost ? MemberRole.HOST : MemberRole.MEMBER;

    let participant = existing;

    const isUser = await UserRepository.findOne({ where: { email: email } });

    if (!existing) {
      const equityAmount = isHost
        ? event.depositAmount
        : Math.floor(event.pendingAmount / event.equityDivision);

      participant = EventParticipantRepository.create({
        email,
        event,
        equityAmount,
        paymentStatus: PaymentStatus.PENDING,
        role,
        user: isUser!,
      });

      await EventParticipantRepository.save(participant);
    } else {
      existing.user = isUser!;

      await EventParticipantRepository.save(existing);

      role = existing.role;
    }

    // const message = `${email} has joined as a ${role} to the event (${event.slug}).`;

    // getIO().to(`event_${event.slug}`).emit("new_participant", {
    //   message,
    //   role,
    //   id: participant!.id,
    //   createdAt: participant!.createdAt,
    // });

    // const existingParticipants = await EventParticipantRepository.find({
    //   where: { event: { slug: event.slug } },
    // });
    //
    // await Promise.all(
    //   existingParticipants.map(async (p) => {
    //     const user = await UserRepository.findOne({
    //       where: { email: p.email },
    //     });
    //     if (!user) return;

    //     const notification = NotificationRepository.create({
    //       title: "New Participant",
    //       description: message,
    //       type: EventType.UPDATE,
    //       read: false,
    //       user,
    //       triggeredBy: user,
    //       event,
    //     });

    //     await NotificationRepository.save(notification);
    //   })
    // );

    return;
  },

  checkInvite: async (inviteToken: string) => {
    const now = new Date();

    const inviteFound = await InviteRepository.findOne({
      where: { inviteToken: inviteToken, expiresAt: MoreThan(now) },
    });

    if (!inviteFound) throw new Error("Invalid or Expired Invite");

    const event = await EventRepository.findOne({
      where: { slug: inviteFound.eventSlug },
    });
    if (!event) throw new Error("Event not found");

    if (inviteFound.registered >= event.passengerCount)
      throw new Error("Participant Limit Reached");

    inviteFound.registered++;

    await InviteRepository.save(inviteFound);

    return { inviteFound, event };
  },

  joinEvent: async (token: string, email: string) => {
    const { inviteFound, event } = await userService.checkInvite(token);

    const exists = await EventParticipantRepository.findOne({
      where: { email: email, event: { slug: event.slug } },
    });

    if (exists) return;

    await userService.addEventParticipant(event, email, inviteFound);
  },

  getAdmin: async () => {
    const adminEmail = process.env.ADMIN_EMAIL!;

    const exists = await UserRepository.findOne({
      where: { email: adminEmail },
    });

    if (!exists) throw new Error("Admin not Set!");

    return exists;
  },
};

export default userService;
