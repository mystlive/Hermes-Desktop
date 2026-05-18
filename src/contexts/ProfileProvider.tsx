import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { profiles as profilesApi } from '../api';
import type { ProfileMetadata } from '../types';
import { ProfileContext } from './ProfileContext';

const DEFAULT_PROFILE_METADATA: ProfileMetadata = {
  name: 'default',
  isDefault: true,
  model: 'default',
  status: 'offline',
};

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfile] = useState<string>(
    localStorage.getItem('hermes_profile') || 'default',
  );
  const [profileMetadata, setProfileMetadata] = useState<ProfileMetadata[]>([DEFAULT_PROFILE_METADATA]);
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfiles = useCallback(async () => {
    try {
      const { data } = await profilesApi.metadata();
      const nextMetadata = Array.isArray(data) && data.length > 0 ? data : [DEFAULT_PROFILE_METADATA];
      setProfileMetadata(nextMetadata);
      setProfiles(nextMetadata.map(profile => profile.name));
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const switchProfile = (name: string) => {
    localStorage.setItem('hermes_profile', name);
    setCurrentProfile(name);
  };

  const createProfile = async (name: string) => {
    await profilesApi.create(name);
    await refreshProfiles();
  };

  const deleteProfile = async (name: string) => {
    await profilesApi.delete(name);
    if (currentProfile === name) {
      switchProfile('default');
    }
    await refreshProfiles();
  };

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        profileMetadata,
        isLoading,
        switchProfile,
        createProfile,
        deleteProfile,
        refreshProfiles,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}
