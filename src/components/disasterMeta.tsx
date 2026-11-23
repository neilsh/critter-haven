import { Activity, CloudHail, Flame, Orbit, Snowflake, Swords, Waves, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BuiltinDisasterType } from '../types/blueprint';

export const DISASTER_META: Record<
  BuiltinDisasterType,
  { shortLabel: string; label: string; icon: (size: number) => ReactNode }
> = {
  earthquake: { shortLabel: 'Quake', label: 'Earthquake', icon: (size) => <Activity size={size} /> },
  hurricane: { shortLabel: 'Wind', label: 'Hurricane', icon: (size) => <Wind size={size} /> },
  flood: { shortLabel: 'Flood', label: 'Flood', icon: (size) => <Waves size={size} /> },
  hail: { shortLabel: 'Hail', label: 'Hail', icon: (size) => <CloudHail size={size} /> },
  fire_tornado: { shortLabel: 'Fire', label: 'Fire Tornado', icon: (size) => <Flame size={size} /> },
  snow_storm: { shortLabel: 'Snow', label: 'Snow Storm', icon: (size) => <Snowflake size={size} /> },
  raid: { shortLabel: 'Raid', label: 'Raids', icon: (size) => <Swords size={size} /> },
  meteor: { shortLabel: 'Meteor', label: 'Meteor Shower', icon: (size) => <Orbit size={size} /> },
};
