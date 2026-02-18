import { VisibilityLevel } from './visibility-level.type';

export interface PersonDossierLimits {
  profiles: number;
  notes: number;
  activities: number;
}

export interface PersonDossierMeta {
  can_view_admin_sections: boolean;
  limits: PersonDossierLimits;
}

export interface PersonDossierRelationItem extends Record<string, unknown> {
  id?: string | number;
  label?: string;
  description?: string;
  summary?: string;
  note?: string;
  platform_name?: string;
  activity_type?: string;
  visibility_level?: VisibilityLevel;
  visibility_scope?: string;
  occurred_at?: string;
  created_at?: string;
  updated_at?: string;
  severity?: string;
}

export interface PersonDossierRelations {
  profiles: PersonDossierRelationItem[];
  notes: PersonDossierRelationItem[];
  activities: PersonDossierRelationItem[];
}

export interface PersonDossierStatsSection {
  count: number;
  last_updated_at?: string | null;
}

export interface PersonDossierStats {
  profiles: PersonDossierStatsSection;
  notes: PersonDossierStatsSection;
  activities: PersonDossierStatsSection;
}

export interface PersonDossierAudit {
  created_at?: string | null;
  updated_at?: string | null;
  last_activity?: {
    id?: string | number;
    type?: string;
    activity_type?: string;
    occurred_at?: string | null;
    severity?: string | null;
    summary?: string | null;
    visibility_level?: VisibilityLevel;
    notes?: string | null;
  } | null;
}

export interface PersonDossierResponse {
  person: Record<string, unknown>;
  relations: PersonDossierRelations;
  stats: PersonDossierStats;
  audit: PersonDossierAudit | null;
  meta: PersonDossierMeta;
}

export interface PersonDossierSnapshot {
  data: PersonDossierResponse;
  etag: string | null;
  fromCache: boolean;
}

export interface PersonDossierPdfSnapshot {
  blob: Blob;
  filename: string;
  etag: string | null;
  fromCache: boolean;
}
