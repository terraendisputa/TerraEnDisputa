/** Approved mockup sea lanes. Paired edge segments represent one bidirectional connection. */
export const SPECIAL_ROUTE_SEGMENTS: Readonly<
  Record<string, readonly { readonly path: string; readonly edge: boolean }[]>
> = {
  'alaska:kamchatka': [
    {
      path: 'M140 150Q108 149 94 175',
      edge: true,
    },
    {
      path: 'M1508 218C1580 235 1645 209 1700 175',
      edge: true,
    },
  ],
  'greenland:iceland': [
    {
      path: 'M722 112Q751 115 770 153',
      edge: false,
    },
  ],
  'greenland:labrador': [
    {
      path: 'M616 157Q640 168 657 137',
      edge: false,
    },
  ],
  'greenland:new_york': [
    {
      path: 'M575 271C666 283 742 223 711 135',
      edge: false,
    },
  ],
  'brazil:sahara': [
    {
      path: 'M688 580Q745 507 784 486',
      edge: false,
    },
  ],
  'iceland:sweden': [
    {
      path: 'M794 166Q830 144 864 171',
      edge: false,
    },
  ],
  'great_britain:iceland': [
    {
      path: 'M809 203Q799 216 787 201',
      edge: false,
    },
  ],
  'germany:great_britain': [
    {
      path: 'M849 214Q868 214 899 226',
      edge: false,
    },
  ],
  'great_britain:spain': [
    {
      path: 'M810 224C777 242 763 291 783 325',
      edge: false,
    },
  ],
  'sahara:spain': [
    {
      path: 'M835 406Q816 382 803 359',
      edge: false,
    },
  ],
  'egypt:israel': [
    {
      path: 'M1003 440L1048 425',
      edge: false,
    },
  ],
  'egypt:turkey': [
    {
      path: 'M1005 434L1029 380',
      edge: false,
    },
  ],
  'egypt:madagascar': [
    {
      path: 'M1064 561L1109 624',
      edge: false,
    },
  ],
  'egypt:poland': [
    {
      path: 'M976 427Q1005 374 1035 337',
      edge: false,
    },
  ],
  'madagascar:zaire': [
    {
      path: 'M906 675C870 735 890 805 973 795Q1015 780 1038 758',
      edge: false,
    },
  ],
  'china:japan': [
    {
      path: 'M1426 316Q1450 307 1465 332',
      edge: false,
    },
  ],
  'india:sumatra': [
    {
      path: 'M1214 499Q1190 541 1223 578',
      edge: false,
    },
  ],
  'japan:kamchatka': [
    {
      path: 'M1525 256Q1531 232 1494 237',
      edge: false,
    },
  ],
  'borneo:malaysia': [
    {
      path: 'M1320 519Q1328 546 1343 582',
      edge: false,
    },
  ],
  'australia:borneo': [
    {
      path: 'M1335 627Q1317 647 1341 663',
      edge: false,
    },
  ],
  'australia:chile': [
    {
      path: 'M534 724C460 757 350 825 94 825',
      edge: true,
    },
    {
      path: 'M1396 791Q1540 852 1700 825',
      edge: true,
    },
  ],
  'australia:java': [
    {
      path: 'M1427 643Q1475 682 1420 722',
      edge: false,
    },
  ],
  'australia:sumatra': [
    {
      path: 'M1241 636Q1245 683 1277 714',
      edge: false,
    },
  ],
};
