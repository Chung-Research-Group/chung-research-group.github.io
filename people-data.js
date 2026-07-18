// Single source of truth for current members and alumni.
window.MTAP_PEOPLE = () => ({
  groups: [
    { title: 'Postdoctoral Researchers', kr: '박사후연구원', people: [
      { slot: 'm-yoon', photo: 'ph-yoon', name: 'Yoon, Sunghyun', kr: '윤성현', interests: 'Atoms/Electrons · AI & Data · Modeling & Optimization', edu: 'Ph.D. Chemical Engineering, Pusan National University (2026) · B.S. Chemical Engineering, Pusan National University (2019)', scholar: 'https://scholar.google.com/citations?user=wedJB5EAAAAJ', github: 'https://github.com/yoonseonghyun', linkedin: 'https://www.linkedin.com/in/sunghyun-yoon-0790b8417/' }
    ]},
    { title: 'Graduate Students', kr: '대학원생', people: [
      { slot: 'm-chen', photo: 'ph-chen', name: 'Chen, Yu', kr: '첸 유, 陈豫', program: 'Ph.D. Program', interests: 'Atoms/Electrons · AI & Data', scholar: 'https://scholar.google.com/citations?user=2z24SzAAAAAJ&hl=en', github: 'https://github.com/DrakeChan', linkedin: 'https://www.linkedin.com/in/yu-chen-913344248', edu: 'B.S. New Energy Science & Technology, Huazhong University of Science and Technology (2020)' },
      { slot: 'm-hassan', photo: 'ph-hassan', name: 'Hassan, Muhammad', kr: '하산 무하마드, حسان محمد', program: 'Ph.D. Program', interests: 'Atoms/Electrons · Modeling & Optimization', scholar: 'https://scholar.google.com/citations?user=6MNpPQsAAAAJ', github: 'https://github.com/hassan-azizi', linkedin: 'https://www.linkedin.com/in/mhassanazizi', edu: 'M.S. Chemical Engineering, Pusan National University (2024) · B.S. Chemical Engineering, NED University of Engineering and Technology (2022)' },
      { slot: 'm-shin', photo: 'ph-shin', name: 'Shin, Changdon', kr: '신창돈', program: "Master's Program", interests: 'AI & Data · Modeling & Optimization · Experiment', scholar: 'https://scholar.google.com/citations?user=vGr2oSYAAAAJ', github: 'https://github.com/ChangdonShin', linkedin: 'https://www.linkedin.com/in/changdon-shin-055637422/', edu: 'B.S. Chemical Engineering, Pusan National University (2025)' },
      { slot: 'm-zhao', photo: 'ph-zhao', name: 'Zhao, Pengyu', kr: '자오 펑위, 赵鹏宇', program: "Master's Program", interests: 'Atoms/Electrons', scholar: 'https://scholar.google.com/citations?user=vW42Ip0AAAAJ', github: 'https://github.com/Finn-Zz', linkedin: 'https://www.linkedin.com/in/pengyu-zhao-93b98436a/', edu: 'B.S. New Energy Science & Technology, Huazhong University of Science and Technology (2024)' },
      { slot: 'm-thong', photo: 'ph-thong', name: 'Siah, Thong', kr: '시아 통, 谢彤', program: "Master's Program", interests: 'Atoms/Electrons · AI & Data', scholar: 'https://scholar.google.com/citations?user=hWhz0HIAAAAJ', github: 'https://github.com/siahthong', linkedin: 'https://www.linkedin.com/in/siah-thong/', edu: 'B.E. Chemical Engineering, Curtin University Malaysia (2023)' },
      { slot: 'm-lee', photo: 'ph-lee', name: 'Lee, Taekgi', kr: '이택기', program: 'B.S./M.S. Program', interests: 'Atoms/Electrons · AI & Data', scholar: 'https://scholar.google.com/citations?user=6blqnjsAAAAJ', edu: 'B.S. Chemical Engineering, Pusan National University (2025)' },
      { slot: 'm-baek', photo: 'ph-baek', name: 'Baek, Mingyu', kr: '백민규', program: "Master's Program, Graduate School of Data Science", interests: 'AI & Data', github: 'https://github.com/100mingyu-rgb', linkedin: 'https://www.linkedin.com/in/mingyu-baek', edu: 'B.S. Chemical Engineering, Kyungpook University (2025)' }
    ]},
    { title: 'Undergraduates', kr: '학부연구생', people: [
      { slot: 'm-kim-hyunji', photo: 'ph-kim-hyunji', name: 'Kim, Hyunji', kr: '김현지', interests: 'Modeling & Optimization', edu: 'Chemical & Biomolecular Engineering, Pusan National University', linkedin: 'https://www.linkedin.com/in/hyunji-kim-051743359', github: 'https://github.com/Kimhyunji4' }
    ]},
    { title: 'Visitors', kr: '방문연구원', people: [] }
  ],
  alumni: [
    { title: 'Graduate Students', kr: '대학원생', people: [
      { id: 'a-sunghyun', name: 'Sunghyun Yoon (윤성현)', detail: 'Ph.D. Chemical Engineering (2019–2026)', now: 'Postdoctoral Researcher, Pusan National University' },
      { id: 'a-haewon', name: 'Haewon Kim (김해원)', detail: 'M.S. Chemical Engineering (2024–2026)', now: 'Engineer, SK hynix' },
      { id: 'a-guobin', name: 'Guobin Zhao (구오빈 자오)', detail: 'Ph.D. Chemical Engineering (2020–2025)', now: 'Postdoctoral Researcher, National University of Singapore' },
      { id: 'a-seulchan', name: 'Seulchan Lee (이슬찬)', detail: 'B.S./M.S. Chemical Engineering (2018–2020)', now: 'SK Innovation' },
      { id: 'a-soomyung', name: 'Soo Myung Nam (남수명)', detail: 'M.S. Chemical Engineering (2017–2019)', now: '한국제지연구소' }
    ]},
    { title: 'Postdoctoral Researchers', kr: '박사후연구원', people: [
      { id: 'a-yang', name: '양창원', detail: '(2022–2023)', now: '부장, Korea Quantum Computing Corp. 한국퀀텀컴퓨팅(주)' },
      { id: 'a-gu', name: '구윤장', detail: '(2021–2022)', now: '남해화학' },
      { id: 'a-ka', name: '가성빈', detail: '(2020–2022)', now: '울산대학교 화학공학과' },
      { id: 'a-anjali', name: 'Anjali Bai', detail: '(2021–2022)', now: 'Postdoctoral Researcher, National University of Singapore' }
    ]},
    { title: 'Researchers & Visitors', kr: '연구원·방문연구원', people: [
      { id: 'a-youri', name: 'Youri Ran', detail: '(2026) Visiting Ph.D. student', now: 'Universiteit van Amsterdam' }
    ]}
  ],
  undergrads: [
    { year: '2025', names: '이나현 · 강다희 · 홍성은' }, { year: '2024', names: '이재훈 · 박채영 · 양윤서' },
    { year: '2023', names: '김해원 · 이예지' }, { year: '2021', names: '김나영 · 박채원' },
    { year: '2020', names: '김혜지' }, { year: '2019', names: '성병관' },
    { year: '2018', names: '한승윤 · 김주용 · 윤성현 · 김건종 · 정충식' }, { year: '2017', names: '서나영' },
    { year: '2016', names: '황진욱 · 이혜지 · 이슬찬' }
  ]
});
