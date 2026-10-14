import { useEffect } from 'react';
import { LoggerService } from '@if/web-common';
import { useAuth } from '@if/web-common-react';

// Who may update the autofill files (2026-09-29): members of the Keycloak group
// "uploaders". This file decides what the PAGE shows - the Update Files tab is
// hidden from everyone else - but it is only a courtesy: UploaderService checks
// the same group, from the access token, on POST /ingest (and /sheets and
// /generate), and answers 403 to anyone outside it. Nothing here is a gate.
//
// Everything a function needs is declared above it (module-level consts first,
// then the functions that use them), so nothing is read before it exists.
export const UPLOADERS_GROUP = 'uploaders';

// Created on demand, not at module load - LoggerService is only configured once
// AppInitializer has finished (see apiLog in ../api/autofillApi).
const uploadersLog = (context) => {
  const base = LoggerService.create('uploaders');
  return context ? base.withContext(context) : base;
};

// "/uploaders" (Keycloak's mapper with "Full group path" on) and "uploaders"
// mean the same group; the backend accepts both, so this does too.
const normaliseGroup = (group) => String(group == null ? '' : group).trim().replace(/^\/+/, '');

// The groups a user is in, from the "groups" claim of their ID token profile -
// the same claim @if/web-common's getUserGroups reads. Written out here rather
// than imported so this file's logic can be tested without the auth library.
// A single-valued claim arrives as a string, so that is accepted too.
export const groupsOf = (user) => {
  const claim = user && user.profile ? user.profile.groups : null;
  const list = Array.isArray(claim) ? claim : typeof claim === 'string' ? [claim] : [];
  return list.map(normaliseGroup).filter((g) => g.length > 0);
};

export const isUploader = (user) => groupsOf(user).includes(UPLOADERS_GROUP);

// The last outcome logged, so the several components that call the hook below
// log a change of answer once rather than once each.
let lastLoggedOutcome = null;

// Is the signed-in user an uploader? Re-evaluates if a token renewal changes
// their groups. Debug-logs the answer (with how many groups the token carried:
// zero means the Keycloak client has no Group Membership mapper) when it changes.
export function useIsUploader() {
  const { user } = useAuth();
  const uploader = isUploader(user);
  const groupCount = groupsOf(user).length;

  useEffect(() => {
    const outcome = `${uploader}:${groupCount}`;
    if (outcome === lastLoggedOutcome) return;
    lastLoggedOutcome = outcome;
    uploadersLog({ uploader, groupCount, group: UPLOADERS_GROUP }).debug('Uploader group check');
  }, [uploader, groupCount]);

  return uploader;
}
