import { useAuth } from '@if/web-common-react';

// Who may clear all the registrations: the one user "CampDad". This decides
// whether the PAGE shows the button - nothing more. UploaderService checks the
// same name, from the access token, on POST registrations/clear and answers 403
// to anyone else, so nothing here is a gate.
export const CLEAR_ALL_USER = 'CampDad';

// The sign-in's preferred_username, compared without regard to case (the same
// way the service does).
export const isClearAllUser = (user) => {
  const name = user && user.profile ? user.profile.preferred_username : null;
  return typeof name === 'string' && name.trim().toLowerCase() === CLEAR_ALL_USER.toLowerCase();
};

export function useIsClearAllUser() {
  const { user } = useAuth();
  return isClearAllUser(user);
}
