import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  RegistrationSource,
  ResidentVerificationStatus,
  User,
  UserRole,
  VendorType,
} from '../generated/client';
import * as bcrypt from 'bcrypt';

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  phone?: string;
  apartment?: string;
  block?: string;
  condominiumId?: string;
  condominiumAccessCode?: string;
  condominiumName?: string;
  personalDocument?: string;
  residenceDocument?: string;
  communicationsConsent?: boolean;
  vendorName?: string;
  vendorCategory?: string;
  vendorDescription?: string;
  vendorCnpj?: string;
  vendorCnae?: string;
  vendorLegalDocument?: string;
  vendorContactPhone?: string;
}

const userWithRelationsInclude = {
  condominium: {
    select: { id: true, name: true, accessCode: true },
  },
  vendorProfile: {
    select: {
      id: true,
      name: true,
      category: true,
      active: true,
      cnpj: true,
      cnae: true,
      legalRepresentativeDocument: true,
      contactPhone: true,
      condominiumId: true,
    },
  },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof userWithRelationsInclude;
}>;

export interface AccountModuleSnapshot {
  module: UserRole;
  enabled: boolean;
  active: boolean;
  missingRequirements: string[];
}

interface ActivateModuleInput {
  phone?: string;
  apartment?: string;
  block?: string;
  communicationsConsent?: boolean;
  personalDocument?: string;
  residenceDocument?: string;
  vehicleInfo?: string;
  condominiumCode?: string;
  vendorName?: string;
  vendorCategory?: string;
  vendorDescription?: string;
  vendorCnpj?: string;
  vendorCnae?: string;
  vendorLegalDocument?: string;
  vendorContactPhone?: string;
}

const modularAccountModules = [
  UserRole.RESIDENT,
  UserRole.DELIVERY_PERSON,
  UserRole.VENDOR,
] as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private getModuleLabel(module: UserRole) {
    switch (module) {
      case UserRole.RESIDENT:
        return 'morador';
      case UserRole.DELIVERY_PERSON:
        return 'entregador';
      case UserRole.VENDOR:
        return 'comercio';
      case UserRole.CONDOMINIUM_ADMIN:
        return 'administrador do condominio';
      default:
        return 'usuario';
    }
  }

  private buildMissingRequirementsMessage(
    module: UserRole,
    missingRequirements: string[],
  ) {
    return `Nao foi possivel ativar o modulo de ${this.getModuleLabel(module)}. Pendencias: ${missingRequirements.join(', ')}.`;
  }

  private getSupportedModulesForUser(user: UserWithRelations): UserRole[] {
    if (user.role === UserRole.CONDOMINIUM_ADMIN) {
      return [UserRole.CONDOMINIUM_ADMIN];
    }

    return [...modularAccountModules];
  }

  private getResidentModuleMissingRequirements(user: UserWithRelations) {
    const missing: string[] = [];

    if (!user.condominiumId?.trim()) missing.push('condominio vinculado');
    if (!user.phone?.trim()) missing.push('telefone');
    if (!user.apartment?.trim()) missing.push('apartamento');
    if (!user.block?.trim()) missing.push('bloco');
    if (!user.communicationsConsent)
      missing.push('autorizacao de comunicacoes');
    if (!user.personalDocument?.trim()) missing.push('documento pessoal');
    if (!user.residenceDocument?.trim())
      missing.push('comprovante de residencia');

    if (user.personalDocument?.trim() && user.residenceDocument?.trim()) {
      if (
        user.residentVerificationStatus ===
        ResidentVerificationStatus.PENDING_REVIEW
      ) {
        missing.push('aprovacao documental do condominio');
      }

      if (
        user.residentVerificationStatus === ResidentVerificationStatus.REJECTED
      ) {
        missing.push('revisao dos documentos rejeitados');
      }
    }

    return missing;
  }

  private getDeliveryPersonModuleMissingRequirements(user: UserWithRelations) {
    const missing: string[] = [];

    if (!user.condominiumId?.trim()) missing.push('condominio vinculado');
    if (!user.phone?.trim()) missing.push('telefone');
    if (!user.personalDocument?.trim()) missing.push('documento pessoal');
    if (!user.vehicleInfo?.trim()) missing.push('dados do veiculo');

    return missing;
  }

  private getVendorModuleMissingRequirements(user: UserWithRelations) {
    const missing: string[] = [];

    if (!user.condominiumId?.trim()) missing.push('condominio vinculado');
    if (!user.phone?.trim()) missing.push('telefone');
    if (!user.vendorProfile?.id) {
      missing.push('cadastro do comercio');
      return missing;
    }

    if (!user.vendorProfile.name?.trim()) missing.push('nome do comercio');
    if (!user.vendorProfile.cnpj?.trim()) missing.push('CNPJ');
    if (!user.vendorProfile.cnae?.trim()) missing.push('CNAE');
    if (!user.vendorProfile.legalRepresentativeDocument?.trim()) {
      missing.push('documento do responsavel legal');
    }
    if (
      user.vendorProfile.condominiumId &&
      user.condominiumId &&
      user.vendorProfile.condominiumId !== user.condominiumId
    ) {
      missing.push('alinhamento do condominio do comercio');
    }

    return missing;
  }

  private getCondominiumAdminModuleMissingRequirements(
    user: UserWithRelations,
  ) {
    const missing: string[] = [];

    if (user.role !== UserRole.CONDOMINIUM_ADMIN) {
      missing.push('permissao administrativa');
    }
    if (!user.condominiumId?.trim()) {
      missing.push('condominio vinculado');
    }

    return missing;
  }

  private getMissingRequirementsForModule(
    user: UserWithRelations,
    module: UserRole,
  ) {
    switch (module) {
      case UserRole.RESIDENT:
        return this.getResidentModuleMissingRequirements(user);
      case UserRole.DELIVERY_PERSON:
        return this.getDeliveryPersonModuleMissingRequirements(user);
      case UserRole.VENDOR:
        return this.getVendorModuleMissingRequirements(user);
      case UserRole.CONDOMINIUM_ADMIN:
        return this.getCondominiumAdminModuleMissingRequirements(user);
      default:
        return ['modulo invalido'];
    }
  }

  private buildAccountModuleSnapshots(
    user: UserWithRelations,
  ): AccountModuleSnapshot[] {
    return this.getSupportedModulesForUser(user).map((module) => {
      const missingRequirements = this.getMissingRequirementsForModule(
        user,
        module,
      );

      return {
        module,
        enabled: missingRequirements.length === 0,
        active: user.role === module,
        missingRequirements,
      };
    });
  }

  buildSafeUserResponse(user: UserWithRelations) {
    const modules = this.buildAccountModuleSnapshots(user);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      activeModule: user.role,
      availableModules: modules
        .filter((module) => module.enabled)
        .map((module) => module.module),
      modules,
      condominiumId: user.condominiumId,
      condominiumName: user.condominium?.name ?? null,
      condominiumAccessCode: user.condominium?.accessCode ?? null,
      apartment: user.apartment,
      block: user.block,
      phone: user.phone ?? null,
      vehicleInfo: user.vehicleInfo ?? null,
      personalDocument: user.personalDocument ?? null,
      residenceDocument: user.residenceDocument ?? null,
      communicationsConsent: user.communicationsConsent ?? false,
      residentVerificationStatus: user.residentVerificationStatus ?? null,
      registrationSource: user.registrationSource ?? null,
      isVendor: user.role === UserRole.VENDOR,
      vendorId: user.vendorProfile?.id ?? null,
      active: user.active,
    };
  }

  async getSafeUserById(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return this.buildSafeUserResponse(user);
  }

  async getAccountModules(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const safeUser = this.buildSafeUserResponse(user);

    return {
      activeModule: safeUser.activeModule,
      availableModules: safeUser.availableModules,
      modules: safeUser.modules,
    };
  }

  private getResidentVerificationStatus(
    role: UserRole,
    personalDocument?: string,
    residenceDocument?: string,
  ) {
    if (role !== UserRole.RESIDENT) {
      return ResidentVerificationStatus.NOT_SUBMITTED;
    }

    if (personalDocument?.trim() && residenceDocument?.trim()) {
      return ResidentVerificationStatus.PENDING_REVIEW;
    }

    return ResidentVerificationStatus.NOT_SUBMITTED;
  }

  private async findCondominiumByCodeOrId(codeOrId: string) {
    const normalized = codeOrId.trim();
    if (!normalized) {
      return null;
    }

    const normalizedUppercase = normalized.toUpperCase();

    return this.prisma.condominium.findFirst({
      where: {
        OR: [
          { id: normalized },
          { accessCode: normalized },
          { accessCode: normalizedUppercase },
        ],
      },
      select: {
        id: true,
        name: true,
        active: true,
        accessCode: true,
      },
    });
  }

  private async generateUniqueCondominiumAccessCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `NSP-${randomBytes(4).toString('hex').toUpperCase()}`;
      const existing = await this.prisma.condominium.findUnique({
        where: { accessCode: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException(
      'Nao foi possivel gerar um codigo de acesso unico para o condominio',
    );
  }

  async create({
    email,
    password,
    name,
    role = UserRole.RESIDENT,
    phone,
    apartment,
    block,
    condominiumId,
    condominiumAccessCode,
    condominiumName,
    personalDocument,
    residenceDocument,
    communicationsConsent,
    vendorName,
    vendorCategory,
    vendorDescription,
    vendorCnpj,
    vendorCnae,
    vendorLegalDocument,
    vendorContactPhone,
  }: CreateUserInput): Promise<User> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Já existe uma conta com este email');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    let resolvedCondominiumId = condominiumId?.trim() || undefined;
    let registrationSource: RegistrationSource = RegistrationSource.DIRECT;

    if (condominiumAccessCode?.trim()) {
      const condominium = await this.findCondominiumByCodeOrId(
        condominiumAccessCode,
      );

      if (!condominium || !condominium.active) {
        throw new BadRequestException(
          'Código de acesso do condomínio não está disponível',
        );
      }

      resolvedCondominiumId = condominium.id;
      registrationSource =
        condominium.accessCode?.toUpperCase() ===
        condominiumAccessCode.trim().toUpperCase()
          ? RegistrationSource.CONDOMINIUM_ACCESS_CODE
          : RegistrationSource.DIRECT;
    }

    if (role === UserRole.CONDOMINIUM_ADMIN) {
      if (!resolvedCondominiumId) {
        const generatedAccessCode =
          await this.generateUniqueCondominiumAccessCode();
        const createdCondominium = await this.prisma.condominium.create({
          data: {
            name: condominiumName?.trim() || `Condomínio de ${name}`,
            accessCode: generatedAccessCode,
          },
        });
        resolvedCondominiumId = createdCondominium.id;
      }
    }

    if (
      (role === UserRole.DELIVERY_PERSON || role === UserRole.VENDOR) &&
      !resolvedCondominiumId?.trim()
    ) {
      throw new BadRequestException(
        'Código do condomínio é obrigatório para este tipo de conta',
      );
    }

    if (role === UserRole.RESIDENT && !phone?.trim()) {
      throw new BadRequestException(
        'Telefone ou WhatsApp é obrigatório para moradores',
      );
    }

    if (role === UserRole.RESIDENT && !communicationsConsent) {
      throw new BadRequestException(
        'É necessário autorizar comunicações para concluir o cadastro',
      );
    }

    if (role === UserRole.DELIVERY_PERSON && !personalDocument?.trim()) {
      throw new BadRequestException(
        'Documento pessoal (RG/CPF) é obrigatório para entregadores',
      );
    }

    if (role === UserRole.VENDOR) {
      if (!vendorName?.trim()) {
        throw new BadRequestException('Nome do comércio é obrigatório');
      }
      if (
        !vendorCnpj?.trim() ||
        !vendorCnae?.trim() ||
        !vendorLegalDocument?.trim()
      ) {
        throw new BadRequestException(
          'CNPJ, CNAE e documento do responsável são obrigatórios para comerciantes',
        );
      }
    }

    if (resolvedCondominiumId) {
      const condominium = await this.prisma.condominium.findUnique({
        where: { id: resolvedCondominiumId },
        select: { id: true, active: true },
      });

      if (!condominium || !condominium.active) {
        throw new BadRequestException(
          'Condomínio informado não está disponível',
        );
      }
    }

    const createdUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone: phone?.trim() || null,
        role,
        apartment,
        block,
        communicationsConsent: Boolean(communicationsConsent),
        personalDocument: personalDocument?.trim() || null,
        residenceDocument: residenceDocument?.trim() || null,
        residentVerificationStatus: this.getResidentVerificationStatus(
          role,
          personalDocument,
          residenceDocument,
        ),
        registrationSource,
        condominiumId: resolvedCondominiumId,
      },
    });

    if (role === UserRole.VENDOR) {
      await this.prisma.vendor.create({
        data: {
          name: vendorName!.trim(),
          category: vendorCategory?.trim() || 'Comércio',
          description: vendorDescription?.trim() || null,
          contactPhone: vendorContactPhone?.trim() || null,
          cnpj: vendorCnpj?.trim() || null,
          cnae: vendorCnae?.trim() || null,
          legalRepresentativeDocument: vendorLegalDocument?.trim() || null,
          type: VendorType.RESIDENT,
          active: true,
          condominiumId: resolvedCondominiumId,
          userId: createdUser.id,
          rating: 5,
          estimatedTimeMinutes: 30,
          minOrderValue: 0,
        },
      });
    }

    return createdUser;
  }

  async findByEmail(email: string): Promise<UserWithRelations | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: userWithRelationsInclude,
    });
  }

  async findById(id: string): Promise<UserWithRelations | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithRelationsInclude,
    });
  }

  async validatePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async getDeliveryPersons(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.DELIVERY_PERSON,
        active: true,
      },
    });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async updateProfile(
    userId: string,
    data: {
      name?: string;
      phone?: string;
      apartment?: string;
      block?: string;
      vehicleInfo?: string;
      personalDocument?: string;
      residenceDocument?: string;
      communicationsConsent?: boolean;
    },
  ): Promise<UserWithRelations> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const nextPhone =
      data.phone !== undefined ? data.phone.trim() : (user.phone ?? '');
    const nextPersonalDocument =
      data.personalDocument !== undefined
        ? data.personalDocument.trim()
        : (user.personalDocument ?? '');
    const nextResidenceDocument =
      data.residenceDocument !== undefined
        ? data.residenceDocument.trim()
        : (user.residenceDocument ?? '');
    const nextCommunicationsConsent =
      data.communicationsConsent !== undefined
        ? Boolean(data.communicationsConsent)
        : user.communicationsConsent;

    const isResidentProfileUpdate =
      user.role === UserRole.RESIDENT &&
      (data.phone !== undefined ||
        data.communicationsConsent !== undefined ||
        data.personalDocument !== undefined ||
        data.residenceDocument !== undefined);

    if (isResidentProfileUpdate && !nextPhone) {
      throw new BadRequestException(
        'Telefone ou WhatsApp é obrigatório para moradores',
      );
    }

    if (isResidentProfileUpdate && !nextCommunicationsConsent) {
      throw new BadRequestException(
        'É necessário autorizar comunicações para manter o cadastro do morador completo',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.phone !== undefined && { phone: data.phone.trim() || null }),
        ...(data.apartment !== undefined && {
          apartment: data.apartment.trim() || null,
        }),
        ...(data.block !== undefined && { block: data.block.trim() || null }),
        ...(data.vehicleInfo !== undefined && {
          vehicleInfo: data.vehicleInfo.trim() || null,
        }),
        ...(data.personalDocument !== undefined && {
          personalDocument: data.personalDocument.trim() || null,
        }),
        ...(data.residenceDocument !== undefined && {
          residenceDocument: data.residenceDocument.trim() || null,
        }),
        ...(data.communicationsConsent !== undefined && {
          communicationsConsent: Boolean(data.communicationsConsent),
        }),
        residentVerificationStatus: this.getResidentVerificationStatus(
          user.role,
          nextPersonalDocument,
          nextResidenceDocument,
        ),
      },
      include: userWithRelationsInclude,
    });
  }

  async updateDocuments(
    userId: string,
    data: {
      personalDocument?: string;
      vendorCnpj?: string;
      vendorCnae?: string;
      vendorLegalDocument?: string;
    },
  ): Promise<UserWithRelations> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (
      user.role === UserRole.DELIVERY_PERSON &&
      !data.personalDocument?.trim()
    ) {
      throw new BadRequestException(
        'Documento pessoal (RG/CPF) é obrigatório para entregadores',
      );
    }

    if (user.role === UserRole.VENDOR) {
      const cnpj = data.vendorCnpj?.trim() || user.vendorProfile?.cnpj;
      const cnae = data.vendorCnae?.trim() || user.vendorProfile?.cnae;
      const legalDoc =
        data.vendorLegalDocument?.trim() ||
        user.vendorProfile?.legalRepresentativeDocument;
      if (!cnpj || !cnae || !legalDoc) {
        throw new BadRequestException(
          'CNPJ, CNAE e documento do responsável são obrigatórios para comerciantes',
        );
      }

      if (user.vendorProfile) {
        await this.prisma.vendor.update({
          where: { id: user.vendorProfile.id },
          data: {
            ...(data.vendorCnpj !== undefined && {
              cnpj: data.vendorCnpj.trim() || null,
            }),
            ...(data.vendorCnae !== undefined && {
              cnae: data.vendorCnae.trim() || null,
            }),
            ...(data.vendorLegalDocument !== undefined && {
              legalRepresentativeDocument:
                data.vendorLegalDocument.trim() || null,
            }),
          },
        });
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.personalDocument !== undefined && {
          personalDocument: data.personalDocument.trim() || null,
        }),
      },
      include: userWithRelationsInclude,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Senha atual incorreta');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
  }

  async linkToCondominium(
    userId: string,
    condominiumCode: string,
  ): Promise<UserWithRelations> {
    const normalizedCondominiumCode = condominiumCode?.trim();
    if (!normalizedCondominiumCode) {
      throw new BadRequestException(
        'Código de acesso do condomínio é obrigatório',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const condominium = await this.findCondominiumByCodeOrId(
      normalizedCondominiumCode,
    );

    if (!condominium || !condominium.active) {
      throw new BadRequestException(
        'Código de acesso do condomínio não está disponível',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        condominiumId: condominium.id,
        registrationSource:
          condominium.accessCode === normalizedCondominiumCode
            ? RegistrationSource.CONDOMINIUM_ACCESS_CODE
            : user.registrationSource,
        residentVerificationStatus: this.getResidentVerificationStatus(
          user.role,
          user.personalDocument ?? undefined,
          user.residenceDocument ?? undefined,
        ),
      },
      include: userWithRelationsInclude,
    });
  }

  async switchActiveModule(userId: string, module: UserRole) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (
      user.role === UserRole.CONDOMINIUM_ADMIN &&
      module !== UserRole.CONDOMINIUM_ADMIN
    ) {
      throw new BadRequestException(
        'Troca de contexto para administradores ainda nao esta disponivel nesta fase.',
      );
    }

    if (module === UserRole.CONDOMINIUM_ADMIN) {
      if (user.role !== UserRole.CONDOMINIUM_ADMIN) {
        throw new BadRequestException(
          'Este modulo nao pode ser ativado para a sua conta.',
        );
      }

      return this.buildSafeUserResponse(user);
    }

    const missingRequirements = this.getMissingRequirementsForModule(
      user,
      module,
    );

    if (missingRequirements.length > 0) {
      throw new BadRequestException(
        this.buildMissingRequirementsMessage(module, missingRequirements),
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { role: module },
      include: userWithRelationsInclude,
    });

    return this.buildSafeUserResponse(updatedUser);
  }

  async activateModule(
    userId: string,
    module: UserRole,
    data: ActivateModuleInput,
  ) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (module === UserRole.CONDOMINIUM_ADMIN) {
      throw new BadRequestException(
        'Ativacao do modulo administrativo nao faz parte desta etapa.',
      );
    }

    if (user.role === UserRole.CONDOMINIUM_ADMIN) {
      throw new BadRequestException(
        'Contas administrativas ainda nao participam da troca modular nesta fase.',
      );
    }

    let resolvedCondominiumId = user.condominiumId ?? undefined;

    if (data.condominiumCode?.trim()) {
      const condominium = await this.findCondominiumByCodeOrId(
        data.condominiumCode,
      );

      if (!condominium || !condominium.active) {
        throw new BadRequestException(
          'Codigo de acesso do condominio nao esta disponivel',
        );
      }

      resolvedCondominiumId = condominium.id;
    }

    const nextPersonalDocument =
      data.personalDocument !== undefined
        ? data.personalDocument.trim()
        : (user.personalDocument ?? '');
    const nextResidenceDocument =
      data.residenceDocument !== undefined
        ? data.residenceDocument.trim()
        : (user.residenceDocument ?? '');

    const userUpdateData: Record<string, unknown> = {};

    if (resolvedCondominiumId !== undefined) {
      userUpdateData.condominiumId = resolvedCondominiumId;
    }
    if (data.phone !== undefined) {
      userUpdateData.phone = data.phone.trim() || null;
    }
    if (data.apartment !== undefined) {
      userUpdateData.apartment = data.apartment.trim() || null;
    }
    if (data.block !== undefined) {
      userUpdateData.block = data.block.trim() || null;
    }
    if (data.personalDocument !== undefined) {
      userUpdateData.personalDocument = nextPersonalDocument || null;
    }
    if (data.residenceDocument !== undefined) {
      userUpdateData.residenceDocument = nextResidenceDocument || null;
    }
    if (data.vehicleInfo !== undefined) {
      userUpdateData.vehicleInfo = data.vehicleInfo.trim() || null;
    }
    if (data.communicationsConsent !== undefined) {
      userUpdateData.communicationsConsent = Boolean(
        data.communicationsConsent,
      );
    }
    if (
      module === UserRole.RESIDENT ||
      data.personalDocument !== undefined ||
      data.residenceDocument !== undefined ||
      data.communicationsConsent !== undefined
    ) {
      userUpdateData.residentVerificationStatus =
        this.getResidentVerificationStatus(
          UserRole.RESIDENT,
          nextPersonalDocument,
          nextResidenceDocument,
        );
    }

    let refreshedUser = user;

    if (Object.keys(userUpdateData).length > 0) {
      refreshedUser = await this.prisma.user.update({
        where: { id: userId },
        data: userUpdateData,
        include: userWithRelationsInclude,
      });
    }

    if (module === UserRole.VENDOR) {
      const vendorName = data.vendorName?.trim();
      const nextVendorName = vendorName || refreshedUser.vendorProfile?.name;
      const nextVendorCategory =
        data.vendorCategory !== undefined
          ? data.vendorCategory.trim() || null
          : (refreshedUser.vendorProfile?.category ?? null);
      const nextVendorCnpj =
        data.vendorCnpj !== undefined
          ? data.vendorCnpj.trim() || null
          : (refreshedUser.vendorProfile?.cnpj ?? null);
      const nextVendorCnae =
        data.vendorCnae !== undefined
          ? data.vendorCnae.trim() || null
          : (refreshedUser.vendorProfile?.cnae ?? null);
      const nextVendorLegalDocument =
        data.vendorLegalDocument !== undefined
          ? data.vendorLegalDocument.trim() || null
          : (refreshedUser.vendorProfile?.legalRepresentativeDocument ?? null);
      const nextVendorContactPhone =
        data.vendorContactPhone !== undefined
          ? data.vendorContactPhone.trim() || null
          : (refreshedUser.vendorProfile?.contactPhone ?? null);

      if (refreshedUser.vendorProfile) {
        await this.prisma.vendor.update({
          where: { id: refreshedUser.vendorProfile.id },
          data: {
            ...(vendorName && { name: vendorName }),
            ...(data.vendorCategory !== undefined && {
              category: nextVendorCategory,
            }),
            ...(data.vendorDescription !== undefined && {
              description: data.vendorDescription.trim() || null,
            }),
            ...(data.vendorCnpj !== undefined && { cnpj: nextVendorCnpj }),
            ...(data.vendorCnae !== undefined && { cnae: nextVendorCnae }),
            ...(data.vendorLegalDocument !== undefined && {
              legalRepresentativeDocument: nextVendorLegalDocument,
            }),
            ...(data.vendorContactPhone !== undefined && {
              contactPhone: nextVendorContactPhone,
            }),
            ...(resolvedCondominiumId !== undefined && {
              condominiumId: resolvedCondominiumId,
            }),
          },
        });
      } else if (nextVendorName) {
        await this.prisma.vendor.create({
          data: {
            name: nextVendorName,
            category: nextVendorCategory,
            description: data.vendorDescription?.trim() || null,
            contactPhone: nextVendorContactPhone,
            cnpj: nextVendorCnpj,
            cnae: nextVendorCnae,
            legalRepresentativeDocument: nextVendorLegalDocument,
            type: VendorType.RESIDENT,
            active: true,
            condominiumId: resolvedCondominiumId,
            userId,
            rating: 5,
            estimatedTimeMinutes: 30,
            minOrderValue: 0,
          },
        });
      }

      const reloadedUser = await this.findById(userId);
      if (!reloadedUser) {
        throw new NotFoundException('Usuário não encontrado');
      }

      refreshedUser = reloadedUser;
    }

    const missingRequirements = this.getMissingRequirementsForModule(
      refreshedUser,
      module,
    );

    if (missingRequirements.length > 0) {
      return this.buildSafeUserResponse(refreshedUser);
    }

    if (refreshedUser.role !== module) {
      refreshedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { role: module },
        include: userWithRelationsInclude,
      });
    }

    return this.buildSafeUserResponse(refreshedUser);
  }

  async listCondominiumUsers(condominiumId: string) {
    return this.prisma.user.findMany({
      where: { condominiumId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        apartment: true,
        block: true,
        phone: true,
        personalDocument: true,
        residenceDocument: true,
        residentVerificationStatus: true,
        vehicleInfo: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async reviewResidentVerification(
    condominiumId: string,
    userId: string,
    status: ResidentVerificationStatus,
  ) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.role !== UserRole.RESIDENT) {
      throw new BadRequestException(
        'A revisão documental está disponível apenas para moradores',
      );
    }

    if (!condominiumId || user.condominiumId !== condominiumId) {
      throw new BadRequestException(
        'Este morador não pertence ao condomínio do administrador',
      );
    }

    if (
      status !== ResidentVerificationStatus.VERIFIED &&
      status !== ResidentVerificationStatus.REJECTED &&
      status !== ResidentVerificationStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException('Status de revisão inválido');
    }

    if (
      status !== ResidentVerificationStatus.REJECTED &&
      (!user.personalDocument?.trim() || !user.residenceDocument?.trim())
    ) {
      throw new BadRequestException(
        'O morador precisa enviar documento pessoal e comprovante de residência antes da revisão',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { residentVerificationStatus: status },
      include: userWithRelationsInclude,
    });

    return this.buildSafeUserResponse(updated);
  }

  async toggleUserStatus(userId: string, active: boolean): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { active },
    });
  }
}
