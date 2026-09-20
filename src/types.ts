// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// types.ts — Interfaces partagées de l'extension
// ============================================================

/**
 * Représente une piste extraite du DOM YouTube.
 */
export interface Track {
  /** ID unique de la vidéo YouTube (ex: "dQw4w9WgXcQ") */
  id: string;
  /** Titre de la vidéo */
  title: string;
  /** Nom de la chaîne / artiste */
  artist: string;
  /** URL absolue de la chaîne (null si introuvable) */
  channelUrl: string | null;
  /** Durée formatée "mm:ss" ou "h:mm:ss" */
  duration: string;
  /** Date de publication relative telle que YouTube l'affiche ("3 months ago"), null si absente */
  publishedAt: string | null;
  /** Progression de lecture déjà effectuée, en % (0-100) ; null si jamais vue */
  watchedPercent: number | null;
  /** URL de la miniature (mqdefault ou hqdefault) */
  thumbnail: string;
  /** Position 0-indexée dans la tracklist */
  index: number;
}

/**
 * État global du lecteur persistant.
 */
export interface PlayerState {
  /** Piste en cours de lecture (null si aucune) */
  currentTrack: Track | null;
  /** Liste complète des pistes extraites */
  playlist: Track[];
  /** Le lecteur joue-t-il actuellement ? */
  isPlaying: boolean;
  /** Muet ? */
  isMuted: boolean;
  /** Volume 0-100 */
  volume: number;
  /** Répéter la piste en boucle ? */
  repeat: boolean;
  /** Qualité vidéo souhaitée */
  quality: VideoQuality;
}

/** Niveaux de qualité du lecteur YouTube (getAvailableQualityLevels) */
export type VideoQuality =
  | 'auto' | 'hd2160' | 'hd1440' | 'hd1080' | 'hd720'
  | 'large' | 'medium' | 'small' | 'tiny';

/** Réponse de background.ts pour les appels à l'API du lecteur */
export interface PlayerQualityInfo {
  available: VideoQuality[];
  current: VideoQuality;
}

/**
 * Événements émis par le player vers les autres modules.
 */
export type PlayerEvent =
  | { type: 'play'; track: Track }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'ended' }
  | { type: 'trackChange'; track: Track };

/**
 * Type des pages YouTube supportées par l'extension.
 */
export type YouTubePage = 'search' | 'channel-videos' | 'playlist' | 'unknown';
