export interface DevConnectionConfig {
  name: string;
  androidHost: string;
  iosHost: string;
  port: number;
  bearerToken: string;
}

export const devConnectionConfig: DevConnectionConfig | null = {
  name: "This Machine",
  androidHost: "10.0.2.2",
  iosHost: "10.0.44.213",
  port: 3773,
  bearerToken: "sk-stavi-a82bb89f431bd01792703abce3fa79fedf17",
};
