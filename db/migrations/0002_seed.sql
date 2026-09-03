-- 0002_seed.sql — vendors and categories. Labels come from netzspec's CATEGORY_META so both
-- systems say the same words; is_hardware marks the categories whose members are software,
-- services or licences, where "no physical spec" is the correct, complete answer.

INSERT INTO vendors (slug, name) VALUES
  ('cisco', 'Cisco'), ('hpe', 'HPE'), ('aruba', 'Aruba'), ('arista', 'Arista'), ('juniper', 'Juniper'),
  ('dell-emc', 'Dell EMC'), ('lenovo', 'Lenovo'), ('extreme', 'Extreme Networks'), ('fortinet', 'Fortinet'),
  ('nvidia', 'NVIDIA'), ('mikrotik', 'MikroTik'), ('ubiquiti', 'Ubiquiti'), ('supermicro', 'Supermicro')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name_en, name_de, is_hardware, sort_order) VALUES
  ('switches',                      'Switches',                        'Switches',                         true,  1),
  ('transceiver',                   'Transceivers & optics',           'Transceiver & Optiken',            true,  2),
  ('routers',                       'Routers',                         'Router',                           true,  3),
  ('optical-networking',            'Optical networking',              'Optical Networking',               true,  4),
  ('interfaces-modules',            'Modules & interface cards',       'Module & Interface-Karten',        true,  5),
  ('security',                      'Security & firewalls',            'Security & Firewalls',             true,  6),
  ('wireless',                      'Wireless (APs & controllers)',    'Wireless (AP & Controller)',       true,  7),
  ('storage-networking',            'Storage networking (SAN)',        'Storage Networking (SAN)',         true,  8),
  ('servers-unified-computing',     'Servers & UCS',                   'Server & UCS',                     true,  9),
  ('hyperconverged-systems',        'Hyperconverged',                  'Hyperconverged',                   true,  10),
  ('hyperconverged-infrastructure', 'Hyperconverged infrastructure',   'Hyperconverged-Infrastruktur',     true,  11),
  ('data-center-networking',        'Data-center networking',          'Data-Center-Networking',           true,  12),
  ('data-center-analytics',         'Data-center analytics',           'Data-Center-Analytics',            false, 13),
  ('unified-communications',        'Unified communications',          'Unified Communications',           true,  14),
  ('collaboration-endpoints',       'Collaboration endpoints',         'Collaboration-Endpoints',          true,  15),
  ('conferencing',                  'Conferencing',                    'Conferencing',                     true,  16),
  ('video',                         'Video',                           'Video',                            true,  17),
  ('contact-center',                'Contact center',                  'Contact Center',                   false, 18),
  ('customer-collaboration',        'Customer collaboration',          'Customer Collaboration',           false, 19),
  ('cloud-systems-management',      'Cloud & management',              'Cloud & Management',               false, 20),
  ('meraki',                        'Meraki',                          'Meraki',                           true,  21),
  ('software',                      'Software',                        'Software',                         false, 22),
  ('ios-nx-os-software',            'IOS / NX-OS software',            'IOS / NX-OS Software',             false, 23)
ON CONFLICT (slug) DO NOTHING;
